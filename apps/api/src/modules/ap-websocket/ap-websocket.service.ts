import { Injectable, Logger } from '@nestjs/common';
import { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { MemoryStore } from '../../shared/memory-store';
import { BaseStation, Label } from '../../shared/models';

function decodeToken(token: string) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [storeCode, apId] = decoded.split('||');
    return { storeCode, apId };
  } catch {
    return { storeCode: undefined, apId: undefined };
  }
}

type ApOnlineMessage = {
  type: 'AP_ONLINE';
  ap_code: string;
  ap_ip?: string;
  ap_version?: string;
  store_code: string;
  host_addr?: string;
  os?: string;
};

type ApChannelListMessage = {
  type: 'AP_CH_LIST';
  ap_channels?: Array<Record<string, unknown>>;
};

type DeviceRetrieveMessage = {
  type: 'DEVICE_RETRIEVE';
  data?: Record<
    string,
    {
      adv_group?: number;
      master_rx_rssi?: number[];
      service_list?: Record<string, unknown>;
    }
  >;
};

type SlaveAdvSvcMessage = {
  type: 'SLAVE_ADV_SVC';
  addr?: string;
  master_rx_rssi?: number;
  service_list?: Array<{ service?: string; b64dat?: string }>;
};

type ApSocketContext = {
  apId?: string;
  storeCode?: string;
  remoteAddress?: string;
  connectedAt: string;
  lastMessageAt?: string;
};

function averageRssi(values?: number[]) {
  const meaningful = (values ?? []).filter((value) => value !== 0);
  if (meaningful.length === 0) {
    return undefined;
  }
  return Math.round(meaningful.reduce((sum, value) => sum + value, 0) / meaningful.length);
}

function normalizeMac(value?: string) {
  if (!value) {
    return undefined;
  }
  const hex = value.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  if (hex.length !== 12) {
    return value.toLowerCase();
  }
  return hex.match(/.{1,2}/g)?.join(':');
}

@Injectable()
export class ApWebsocketService {
  private readonly logger = new Logger(ApWebsocketService.name);
  private attached = false;
  private readonly activeSockets = new Map<string, WebSocket>();
  private readonly socketContexts = new WeakMap<WebSocket, ApSocketContext>();

  constructor(private readonly db: MemoryStore) {}

  attach(server: HttpServer) {
    if (this.attached) {
      return;
    }

    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });

    wss.on('connection', (ws, request) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      const token = url.searchParams.get('token') ?? '';
      const session = this.db.apSessions.get(token);
      const decoded = decodeToken(token);
      const storeCode = session?.storeCode ?? decoded.storeCode;
      const apId = session?.apId ?? decoded.apId;
      const context: ApSocketContext = {
        storeCode,
        apId,
        remoteAddress: request.socket.remoteAddress,
        connectedAt: new Date().toISOString(),
      };
      this.socketContexts.set(ws, context);

      this.db.recordRequest({
        method: 'WS-UPGRADE',
        path: request.url ?? '/api/websocket/connect',
        statusCode: 101,
        ip: request.socket.remoteAddress,
        userAgent: request.headers['user-agent'],
        body: { event: 'connected', storeCode, apId },
      });

      if (apId) {
        this.activeSockets.set(apId, ws);
        const current = this.db.baseStations.get(apId);
        this.db.baseStations.set(apId, {
          id: apId,
          storeCode: storeCode ?? current?.storeCode ?? 'unknown',
          name: current?.name ?? `AP ${apId}`,
          mac: current?.mac ?? apId,
          ip: request.socket.remoteAddress,
          firmware: current?.firmware ?? 'unknown',
          status: 'online',
          lastSeenAt: new Date().toISOString(),
          metrics: current?.metrics ?? {},
        });
        this.db.save();
      }

      ws.send(JSON.stringify({ code: 0, msg: 'connected', time: new Date().toISOString() }));

      ws.on('message', (message) => {
        const text = message.toString();
        this.applyApMessage(text, ws, request.socket.remoteAddress);
        const latestContext = this.socketContexts.get(ws);
        if (latestContext) {
          latestContext.lastMessageAt = new Date().toISOString();
        }
        this.db.recordRequest({
          method: 'WS',
          path: request.url ?? '/api/websocket/connect',
          statusCode: 200,
          ip: request.socket.remoteAddress,
          userAgent: request.headers['user-agent'],
          body: { event: 'message', text },
        });
        ws.send(JSON.stringify({ code: 0, msg: 'ack', time: new Date().toISOString() }));
      });

      ws.on('close', () => {
        const latestContext = this.socketContexts.get(ws);
        if (latestContext?.apId && this.activeSockets.get(latestContext.apId) === ws) {
          this.activeSockets.delete(latestContext.apId);
        }
        if (latestContext?.apId) {
          const current = this.db.baseStations.get(latestContext.apId);
          if (current) {
            this.db.baseStations.set(current.id, {
              ...current,
              status: 'offline',
              lastSeenAt: new Date().toISOString(),
            });
            this.db.save();
          }
        }
        this.logger.log(`AP websocket closed: ${latestContext?.apId ?? apId ?? 'unknown'}`);
      });
    });

    this.attached = true;
  }

  getConnectionStatus(apId: string) {
    const ws = this.activeSockets.get(apId);
    const context = ws ? this.socketContexts.get(ws) : undefined;
    return {
      apId,
      connected: Boolean(ws && ws.readyState === WebSocket.OPEN),
      connectedAt: context?.connectedAt,
      lastMessageAt: context?.lastMessageAt,
      remoteAddress: context?.remoteAddress,
    };
  }

  sendRaw(apId: string, payload: unknown) {
    const ws = this.activeSockets.get(apId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return {
        ok: false,
        reason: 'AP websocket is not connected',
      };
    }

    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    ws.send(text);
    this.db.recordRequest({
      method: 'WS-OUT',
      path: '/ws',
      statusCode: 200,
      body: { apId, text },
    });
    return {
      ok: true,
      bytes: Buffer.byteLength(text),
      text,
    };
  }

  private applyApMessage(text: string, ws: WebSocket, remoteAddress?: string) {
    if (text === 'ping') {
      return;
    }

    let parsed: { type?: string };
    try {
      parsed = JSON.parse(text) as { type?: string };
    } catch {
      return;
    }

    if (parsed.type === 'AP_ONLINE') {
      this.applyApOnline(parsed as ApOnlineMessage, ws, remoteAddress);
      return;
    }

    if (parsed.type === 'AP_CH_LIST') {
      this.applyApChannels(parsed as ApChannelListMessage);
      return;
    }

    if (parsed.type === 'DEVICE_RETRIEVE') {
      this.applyDeviceRetrieve(parsed as DeviceRetrieveMessage);
      return;
    }

    if (parsed.type === 'SLAVE_ADV_SVC') {
      this.applySlaveAdv(parsed as SlaveAdvSvcMessage);
    }
  }

  private applyApOnline(message: ApOnlineMessage, ws: WebSocket, remoteAddress?: string) {
    const apId = message.ap_code;
    this.activeSockets.set(apId, ws);
    this.socketContexts.set(ws, {
      ...(this.socketContexts.get(ws) ?? { connectedAt: new Date().toISOString() }),
      apId,
      storeCode: message.store_code,
      remoteAddress,
      lastMessageAt: new Date().toISOString(),
    });

    const current = this.db.baseStations.get(apId);
    const ap: BaseStation = {
      id: apId,
      storeCode: message.store_code,
      name: current?.name ?? `AP ${apId}`,
      mac: message.ap_code,
      ip: message.ap_ip ?? remoteAddress,
      firmware: message.ap_version ?? current?.firmware,
      os: message.os,
      hostAddr: message.host_addr,
      channels: current?.channels,
      status: 'online',
      lastSeenAt: new Date().toISOString(),
      metrics: current?.metrics ?? {},
    };
    this.db.baseStations.set(ap.id, ap);
    this.db.save();
  }

  private applyApChannels(message: ApChannelListMessage) {
    const ap = [...this.db.baseStations.values()].find((item) => item.status === 'online');
    if (!ap) {
      return;
    }
    this.db.baseStations.set(ap.id, {
      ...ap,
      channels: message.ap_channels ?? [],
      lastSeenAt: new Date().toISOString(),
      metrics: {
        ...ap.metrics,
      },
    });
    this.db.save();
  }

  private applyDeviceRetrieve(message: DeviceRetrieveMessage) {
    const entries = Object.entries(message.data ?? {});
    const ap = [...this.db.baseStations.values()].find((item) => item.status === 'online');
    const apId = ap?.id;
    const storeCode = ap?.storeCode ?? process.env.UPSTREAM_STORE_CODE ?? '20248517';

    for (const [labelId, payload] of entries) {
      const current = this.db.labels.get(labelId);
      const label: Label = {
        id: labelId,
        storeCode,
        apId,
        sku: current?.sku ?? labelId,
        title: current?.title ?? `ESL ${labelId}`,
        price: current?.price ?? 0,
        currency: current?.currency ?? 'CNY',
        status: 'online',
        battery: current?.battery,
        rssi: averageRssi(payload.master_rx_rssi),
        services: payload.service_list,
        updatedAt: new Date().toISOString(),
      };
      this.db.labels.set(label.id, label);
    }

    if (ap) {
      this.db.baseStations.set(ap.id, {
        ...ap,
        lastSeenAt: new Date().toISOString(),
        metrics: {
          ...ap.metrics,
          labelsOnline: entries.length,
          labelsTotal: entries.length,
        },
      });
    }

    this.db.save();
  }

  private applySlaveAdv(message: SlaveAdvSvcMessage) {
    const labelId = message.addr?.slice(0, 8);
    if (!labelId) {
      return;
    }

    const ap = [...this.db.baseStations.values()].find((item) => item.status === 'online');
    const current = this.db.labels.get(labelId);
    const services = Object.fromEntries((message.service_list ?? []).map((item) => [item.service ?? 'unknown', item.b64dat ?? '']));
    this.db.labels.set(labelId, {
      id: labelId,
      storeCode: current?.storeCode ?? ap?.storeCode ?? process.env.UPSTREAM_STORE_CODE ?? '20248517',
      apId: current?.apId ?? ap?.id,
      sku: current?.sku ?? labelId,
      title: current?.title ?? `ESL ${labelId}`,
      price: current?.price ?? 0,
      currency: current?.currency ?? 'CNY',
      status: 'online',
      battery: current?.battery,
      rssi: message.master_rx_rssi,
      services: { ...(current?.services ?? {}), ...services },
      updatedAt: new Date().toISOString(),
    });

    if (ap) {
      this.db.baseStations.set(ap.id, {
        ...ap,
        lastSeenAt: new Date().toISOString(),
        metrics: {
          ...ap.metrics,
          rssi: message.master_rx_rssi,
        },
      });
    }

    this.db.save();
  }
}
