import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { Server as HttpServer } from 'node:http';
import { gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { MemoryStore } from '../../shared/memory-store';
import { BaseStation, Label, OfficialDownlinkCapture } from '../../shared/models';
import { MqttService } from '../mqtt/mqtt.service';

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

type DownlinkTrace = {
  id: string;
  apId: string;
  transport: 'websocket-text' | 'websocket-binary' | 'mqtt-bridge';
  direction: 'cloud_to_ap';
  createdAt: string;
  updatedAt: string;
  status: 'socket_missing' | 'socket_write_pending' | 'socket_write_ok' | 'socket_write_error' | 'ap_reply_seen';
  bytes?: number;
  commandType?: string;
  labelId?: string;
  queueId?: number;
  topic?: string;
  error?: string;
  reply?: Record<string, unknown>;
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

function normalizeIp(value?: string) {
  if (!value) {
    return undefined;
  }
  return value.replace(/^::ffff:/, '');
}

function offlineAfterMs() {
  return Number(process.env.AP_OFFLINE_AFTER_SECONDS ?? 90) * 1000;
}

function summarizeOutboundText(text: string) {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed.type === 'READ_WRITE_SVC') {
      return {
        text: text.length <= 1200 ? text : `${text.slice(0, 400)}...`,
        text_chars: text.length,
        payload: summarizeReadWriteSvc(parsed),
      };
    }
    if (parsed.type === 'ESL_WRITE' && parsed.data && typeof parsed.data === 'object') {
      const data = parsed.data as { esl_code?: unknown; img?: { queue_id?: unknown; mode?: unknown; orientation?: unknown; source?: string } };
      return {
        text: `${text.slice(0, 400)}...`,
        payload: {
          type: parsed.type,
          esl_code: data.esl_code,
          img: data.img ? {
            queue_id: data.img.queue_id,
            mode: data.img.mode,
            orientation: data.img.orientation,
            source_chars: typeof data.img.source === 'string' ? data.img.source.length : 0,
            source_prefix: typeof data.img.source === 'string' ? data.img.source.slice(0, 32) : undefined,
          } : undefined,
        },
      };
    }
  } catch {
    // Fall through to a simple preview.
  }

  if (text.length <= 1200) {
    return { text };
  }

  return {
    text: `${text.slice(0, 400)}...`,
    text_chars: text.length,
  };
}

function summarizeReadWriteSvc(command: Record<string, unknown>) {
  const opas = Array.isArray(command.opas) ? command.opas : [];
  return {
    type: command.type,
    opas: opas.map((opa) => {
      const row = opa && typeof opa === 'object' ? opa as Record<string, unknown> : {};
      const cmds = Array.isArray(row.cmds) ? row.cmds : [];
      return {
        addr: row.addr,
        cmdCount: cmds.length,
        cmds: cmds.map((cmd) => {
          const item = cmd && typeof cmd === 'object' ? cmd as Record<string, unknown> : {};
          const b64dat = typeof item.b64dat === 'string' ? item.b64dat : '';
          return {
            id: item.id,
            type: item.type,
            service: item.service,
            bigsize: item.bigsize,
            supersize: item.supersize,
            mtu: item.mtu,
            b64Chars: b64dat.length || undefined,
            bytes: b64dat ? Buffer.from(b64dat, 'base64').length : undefined,
            b64Prefix: b64dat ? b64dat.slice(0, 40) : undefined,
          };
        }),
      };
    }),
  };
}

function rewriteReadWriteSvcAddress(text: string, targetLabelId?: string) {
  if (!targetLabelId) {
    return text;
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed.type !== 'READ_WRITE_SVC' || !Array.isArray(parsed.opas)) {
      return text;
    }
    parsed.opas = parsed.opas.map((opa) => {
      if (!opa || typeof opa !== 'object') {
        return opa;
      }
      return { ...(opa as Record<string, unknown>), addr: targetLabelId };
    });
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

function mutateReadWriteSvc(
  text: string,
  options: {
    targetLabelId?: string;
    replacementService03B64?: string;
    replacementService07B64?: string;
    replacementService0cB64?: string;
    service03ByteOffset?: number;
    service03ByteXor?: number;
    spliceSourceService03B64?: string;
    spliceOffset?: number;
  } = {},
) {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed.type !== 'READ_WRITE_SVC' || !Array.isArray(parsed.opas)) {
      return text;
    }
    parsed.opas = parsed.opas.map((opa) => {
      if (!opa || typeof opa !== 'object') {
        return opa;
      }
      const row = opa as Record<string, unknown>;
      const cmds = Array.isArray(row.cmds) ? row.cmds.map((cmd) => ({ ...(cmd as Record<string, unknown>) })) : [];
      let sawService07 = false;
      const nextCmds = cmds.map((cmd) => {
        if (typeof cmd.service === 'string' && cmd.service === '01-00-00-03' && options.replacementService03B64) {
          cmd.b64dat = options.replacementService03B64;
        } else if (typeof cmd.service === 'string' && cmd.service === '01-00-00-0c' && options.replacementService0cB64) {
          cmd.b64dat = options.replacementService0cB64;
        } else if (typeof cmd.service === 'string' && cmd.service === '01-00-00-03' && typeof cmd.b64dat === 'string') {
          const original = Buffer.from(cmd.b64dat, 'base64');
          let mutated = Buffer.from(original);
          if (
            typeof options.service03ByteOffset === 'number'
            && options.service03ByteOffset >= 0
            && options.service03ByteOffset < mutated.length
            && typeof options.service03ByteXor === 'number'
          ) {
            mutated[options.service03ByteOffset] ^= options.service03ByteXor & 0xff;
          }
          if (options.spliceSourceService03B64 && typeof options.spliceOffset === 'number') {
            const right = Buffer.from(options.spliceSourceService03B64, 'base64');
            const cut = Math.max(0, Math.min(mutated.length, Math.min(right.length, options.spliceOffset)));
            mutated = Buffer.concat([mutated.subarray(0, cut), right.subarray(cut)]);
          }
          cmd.b64dat = mutated.toString('base64');
        }
        if (typeof cmd.service === 'string' && cmd.service === '01-00-00-07') {
          sawService07 = true;
          if (options.replacementService07B64) {
            cmd.b64dat = options.replacementService07B64;
          }
        }
        return cmd;
      });
      if (!sawService07 && options.replacementService07B64) {
        nextCmds.push({
          id: 16,
          type: 'WRITE_SVC',
          service: '01-00-00-07',
          b64dat: options.replacementService07B64,
        });
      }
      return {
        ...row,
        ...(options.targetLabelId ? { addr: options.targetLabelId } : {}),
        cmds: nextCmds,
      };
    });
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

function summarizeWsPayload(message: RawData | string) {
  if (typeof message === 'string') {
    return summarizeOutboundText(message);
  }
  const bytes = Buffer.isBuffer(message)
    ? message
    : Array.isArray(message)
      ? Buffer.concat(message)
      : Buffer.from(message as ArrayBuffer);
  const text = bytes.toString('utf8');
  const printable = bytes.length > 0 && [...text.slice(0, Math.min(text.length, 80))].every((char) => {
    const code = char.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
  });
  if (printable && (text.startsWith('{') || text === 'ping')) {
    return summarizeOutboundText(text);
  }
  return {
    bytes: bytes.length,
    base64_prefix: bytes.toString('base64').slice(0, 120),
    hex_prefix: bytes.subarray(0, 48).toString('hex'),
  };
}

function officialProxyEnabled() {
  return false;
}

function officialWsUrl(requestUrl: string, host?: string, token?: string) {
  const explicit = process.env.OFFICIAL_WS_URL;
  const base = explicit
    ? explicit.endsWith('/') ? explicit : `${explicit}/`
    : (process.env.OFFICIAL_CLOUD_URL || process.env.UPSTREAM_CLOUD_URL || 'http://43.153.107.21').replace(/\/$/, '');
  const url = new URL(requestUrl, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (host && !url.host) {
    url.host = host;
  }
  if (process.env.OFFICIAL_WS_TOKEN_MODE === 'query' && token && !url.searchParams.has('token')) {
    url.searchParams.set('token', token);
  }
  return url.toString();
}

function encodeBase64(value: string) {
  return Buffer.from(value, 'utf8').toString('base64');
}

@Injectable()
export class ApWebsocketService {
  private readonly logger = new Logger(ApWebsocketService.name);
  private attached = false;
  private readonly activeSockets = new Map<string, WebSocket>();
  private readonly socketContexts = new WeakMap<WebSocket, ApSocketContext>();
  private readonly downlinkTraces: DownlinkTrace[] = [];

  constructor(
    private readonly db: MemoryStore,
    private readonly mqtt: MqttService,
  ) {}

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
      const fallbackSession = this.findLatestSessionByRemoteAddress(request.socket.remoteAddress);
      const session = this.db.apSessions.get(token) ?? fallbackSession;
      const decoded = decodeToken(token);
      const storeCode = session?.storeCode ?? decoded.storeCode;
      const apId = session?.apId ?? decoded.apId;
      const officialSession = session?.source === 'official' ? session : fallbackSession?.source === 'official' ? fallbackSession : undefined;
      const upstreamToken = officialSession ? token || fallbackSession?.token : undefined;
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

      const officialProxy = officialProxyEnabled() && officialSession
        ? this.attachOfficialProxy(ws, request, context, upstreamToken)
        : undefined;

      if (officialProxyEnabled() && !officialSession) {
        this.db.recordRequest({
          method: 'OFFICIAL-WS-SKIP',
          path: request.url ?? '/ws',
          statusCode: 424,
          ip: request.socket.remoteAddress,
          userAgent: request.headers['user-agent'],
          body: {
            apId,
            storeCode,
            sessionSource: session?.source,
            reason: 'Official auth did not succeed for this AP session, so upstream official WebSocket proxy is disabled for this connection.',
          },
        });
      }

      if (!officialProxy) {
        ws.send(JSON.stringify({ code: 0, msg: 'connected', time: new Date().toISOString() }));
      }

      ws.on('message', (message) => {
        const text = message.toString();
        this.applyApMessage(text, ws, request.socket.remoteAddress);
        const latestContext = this.socketContexts.get(ws);
        if (latestContext) {
          latestContext.lastMessageAt = new Date().toISOString();
        }
        this.observeApReply(text, latestContext);
        void this.bridgeUplinkToMqtt(text, ws);
        this.db.recordRequest({
          method: 'WS',
          path: request.url ?? '/api/websocket/connect',
          statusCode: 200,
          ip: request.socket.remoteAddress,
          userAgent: request.headers['user-agent'],
          body: { event: 'message', text },
        });
        if (officialProxy) {
          officialProxy.forward(this.rewriteOfficialUplink(message, latestContext));
          return;
        }
        ws.send(JSON.stringify({ code: 0, msg: 'ack', time: new Date().toISOString() }));
      });

      ws.on('close', () => {
        officialProxy?.close();
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

  private findLatestSessionByRemoteAddress(remoteAddress?: string) {
    const ip = normalizeIp(remoteAddress);
    if (!ip) {
      return undefined;
    }
    const ap = [...this.db.baseStations.values()].find((item) => normalizeIp(item.ip) === ip);
    return ap ? this.db.latestApSessions.get(ap.id) : undefined;
  }

  private attachOfficialProxy(apWs: WebSocket, request: IncomingMessage, context: ApSocketContext, upstreamToken?: string) {
    const targetUrl = officialWsUrl(request.url ?? '/ws', request.headers.host, upstreamToken);
    const queue: Array<RawData | string> = [];
    let upstreamOpen = false;
    let upstreamClosed = false;
    const upstream = new WebSocket(targetUrl, {
      headers: {
        'user-agent': Array.isArray(request.headers['user-agent']) ? request.headers['user-agent'].join(' ') : request.headers['user-agent'] ?? 'Go-http-client/1.1',
      },
    });

    this.db.recordRequest({
      method: 'OFFICIAL-WS-CONNECT',
      path: targetUrl,
      statusCode: 100,
      ip: request.socket.remoteAddress,
      userAgent: request.headers['user-agent'],
      body: {
        apId: context.apId,
        storeCode: context.storeCode,
        targetUrl,
        authTokenAvailable: Boolean(upstreamToken),
        tokenAttached: process.env.OFFICIAL_WS_TOKEN_MODE === 'query' && Boolean(upstreamToken),
      },
    });

    upstream.on('open', () => {
      upstreamOpen = true;
      this.db.recordRequest({
        method: 'OFFICIAL-WS-OPEN',
        path: targetUrl,
        statusCode: 101,
        ip: request.socket.remoteAddress,
        userAgent: request.headers['user-agent'],
        body: {
          apId: context.apId,
          storeCode: context.storeCode,
          queuedFrames: queue.length,
        },
      });
      while (queue.length > 0 && upstream.readyState === WebSocket.OPEN) {
        upstream.send(queue.shift() as RawData | string);
      }
    });

    upstream.on('message', (message, isBinary) => {
      const summary = summarizeWsPayload(message);
      const capture = this.captureOfficialDownlink(message, isBinary, targetUrl, context, summary);
      this.db.recordRequest({
        method: 'OFFICIAL-WS-DOWN',
        path: targetUrl,
        statusCode: 200,
        ip: request.socket.remoteAddress,
        userAgent: request.headers['user-agent'],
        body: {
          apId: context.apId,
          storeCode: context.storeCode,
          captureId: capture.id,
          replayable: capture.replayable,
          ...summary,
        },
      });
      if (apWs.readyState === WebSocket.OPEN) {
        apWs.send(message);
      }
    });

    upstream.on('close', (code, reason) => {
      upstreamClosed = true;
      this.db.recordRequest({
        method: 'OFFICIAL-WS-CLOSE',
        path: targetUrl,
        statusCode: Number(code) || 200,
        ip: request.socket.remoteAddress,
        userAgent: request.headers['user-agent'],
        body: {
          apId: context.apId,
          storeCode: context.storeCode,
          code,
          reason: reason.toString(),
        },
      });
    });

    upstream.on('error', (error) => {
      this.db.recordRequest({
        method: 'OFFICIAL-WS-ERROR',
        path: targetUrl,
        statusCode: 502,
        ip: request.socket.remoteAddress,
        userAgent: request.headers['user-agent'],
        body: {
          apId: context.apId,
          storeCode: context.storeCode,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });

    return {
      forward: (message: RawData | string) => {
        const summary = summarizeWsPayload(message);
        this.db.recordRequest({
          method: 'OFFICIAL-WS-UP',
          path: targetUrl,
          statusCode: upstreamOpen ? 200 : 102,
          ip: request.socket.remoteAddress,
          userAgent: request.headers['user-agent'],
          body: {
            apId: context.apId,
            storeCode: context.storeCode,
            queued: !upstreamOpen,
            ...summary,
          },
        });
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(message);
          return;
        }
        if (!upstreamClosed) {
          queue.push(message);
        }
      },
      close: () => {
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
          upstream.close();
        }
      },
    };
  }

  private rewriteOfficialUplink(message: RawData, context?: ApSocketContext): RawData | string {
    if (typeof message !== 'string' && !Buffer.isBuffer(message)) {
      return message;
    }
    const text = message.toString();
    if (!text.startsWith('{')) {
      return message;
    }

    const upstreamUsername = process.env.UPSTREAM_USERNAME;
    const upstreamPassword = process.env.UPSTREAM_PASSWORD;
    if (!upstreamUsername || !upstreamPassword) {
      return message;
    }

    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (parsed.type !== 'AP_ONLINE') {
        return message;
      }
      const apId = String(parsed.ap_code ?? context?.apId ?? '');
      if (!apId) {
        return message;
      }
      const rewritten = {
        ...parsed,
        store_code: process.env.UPSTREAM_STORE_CODE ?? parsed.store_code,
        user: encodeBase64(upstreamUsername),
        password: encodeBase64(`${upstreamPassword}||${apId}`),
      };
      const nextText = JSON.stringify(rewritten);
      this.db.recordRequest({
        method: 'OFFICIAL-WS-REWRITE',
        path: '/ws',
        statusCode: 200,
        ip: context?.remoteAddress,
        body: {
          apId,
          storeCode: rewritten.store_code,
          type: parsed.type,
          rewrittenUser: true,
          reason: 'AP_ONLINE credentials were rewritten before forwarding to the official cloud.',
        },
      });
      return nextText;
    } catch {
      return message;
    }
  }

  getConnectionStatus(apId: string) {
    const ws = this.activeSockets.get(apId);
    const context = ws ? this.socketContexts.get(ws) : undefined;
    const activityTime = context?.lastMessageAt ?? context?.connectedAt;
    const activeRecently = activityTime ? Date.now() - new Date(activityTime).getTime() <= offlineAfterMs() : false;
    return {
      apId,
      connected: Boolean(ws && ws.readyState === WebSocket.OPEN),
      activeRecently,
      connectedAt: context?.connectedAt,
      lastMessageAt: context?.lastMessageAt,
      remoteAddress: context?.remoteAddress,
    };
  }

  getDownlinkTraces(apId?: string) {
    return this.downlinkTraces
      .filter((trace) => !apId || trace.apId === apId)
      .slice(-100)
      .reverse();
  }

  getDownlinkTrace(apId: string, traceId: string) {
    return this.downlinkTraces.find((trace) => trace.apId === apId && trace.id === traceId);
  }

  getOfficialDownlinks(apId?: string) {
    return this.db.officialDownlinkCaptures
      .filter((item) => !apId || item.apId === apId)
      .slice(-80)
      .reverse()
      .map((item) => ({
        ...item,
        text: item.text,
        textPreview: item.text && item.text.length > 6000 ? `${item.text.slice(0, 6000)}...` : item.text,
      }));
  }

  replayOfficialDownlink(
    apId: string,
    captureId: string,
    options: {
      targetLabelId?: string;
      replacementService03B64?: string;
      replacementService07B64?: string;
      replacementService0cB64?: string;
      service03ByteOffset?: number;
      service03ByteXor?: number;
      spliceSourceCaptureId?: string;
      spliceOffset?: number;
    } = {},
  ) {
    const capture = this.db.officialDownlinkCaptures.find((item) => item.id === captureId && item.apId === apId);
    if (!capture) {
      return { ok: false, reason: 'capture_not_found' };
    }
    if (!capture.replayable) {
      return { ok: false, reason: 'capture_not_replayable', captureId };
    }

    const spliceSourceCapture = options.spliceSourceCaptureId
      ? this.db.officialDownlinkCaptures.find((item) => item.id === options.spliceSourceCaptureId && item.apId === apId)
      : undefined;
    const spliceSourceService03B64 = spliceSourceCapture?.text
      ? (() => {
        try {
          const parsed = JSON.parse(spliceSourceCapture.text ?? '') as Record<string, unknown>;
          if (parsed.type !== 'READ_WRITE_SVC' || !Array.isArray(parsed.opas)) {
            return undefined;
          }
          for (const opa of parsed.opas) {
            if (!opa || typeof opa !== 'object') {
              continue;
            }
            const row = opa as Record<string, unknown>;
            const cmds = Array.isArray(row.cmds) ? row.cmds : [];
            for (const cmd of cmds) {
              if (cmd && typeof cmd === 'object' && (cmd as Record<string, unknown>).service === '01-00-00-03' && typeof (cmd as Record<string, unknown>).b64dat === 'string') {
                return (cmd as Record<string, unknown>).b64dat as string;
              }
            }
          }
          return undefined;
        } catch {
          return undefined;
        }
      })()
      : undefined;

    const replayText = capture.kind === 'text'
      ? mutateReadWriteSvc(capture.text ?? '', options)
      : undefined;
    const replayTextWithAdvanced = replayText && (typeof options.service03ByteOffset === 'number' || spliceSourceService03B64)
      ? mutateReadWriteSvc(capture.text ?? '', {
        ...options,
        spliceSourceService03B64,
      })
      : undefined;
    const finalReplayText = replayTextWithAdvanced ?? replayText;
    const replayMeta = finalReplayText ? this.extractCommandMetaFromText(finalReplayText) : {};
    const meta = {
      type: capture.commandType ?? 'official_replay',
      labelId: options.targetLabelId ?? capture.labelId,
      queueId: capture.queueId,
      sourceCaptureId: capture.id,
      sourceUrl: capture.targetUrl,
      addressRewritten: Boolean(options.targetLabelId),
    };
    const result = capture.kind === 'text'
      ? this.sendRaw(apId, finalReplayText ?? '')
      : this.sendBinary(apId, Buffer.from(capture.base64 ?? '', 'base64'), meta);

    this.db.recordRequest({
      method: 'OFFICIAL-WS-REPLAY',
      path: `/ap/${apId}/captures/${captureId}`,
      statusCode: result.ok ? 200 : 503,
      body: {
        apId,
        captureId,
        kind: capture.kind,
        bytes: capture.bytes,
        commandType: capture.commandType,
        labelId: capture.labelId,
        targetLabelId: options.targetLabelId,
        replacementService0cB64: Boolean(options.replacementService0cB64) ? '[provided]' : undefined,
        service03ByteOffset: options.service03ByteOffset,
        service03ByteXor: options.service03ByteXor,
        spliceSourceCaptureId: options.spliceSourceCaptureId,
        spliceOffset: options.spliceOffset,
        replayMeta,
        queueId: capture.queueId,
        result,
        meaning: result.ok
          ? 'Captured official downlink was replayed to the local AP WebSocket. Wait for AP_REPORT_STATUS or other AP replies.'
          : 'Replay did not reach the local AP WebSocket.',
      },
    });
    return {
      ok: result.ok,
      captureId,
      targetLabelId: options.targetLabelId,
      replay: result,
    };
  }

  diffOfficialDownlinks(apId: string, leftId: string, rightId: string) {
    const left = this.db.officialDownlinkCaptures.find((item) => item.id === leftId && item.apId === apId);
    const right = this.db.officialDownlinkCaptures.find((item) => item.id === rightId && item.apId === apId);
    if (!left || !right) {
      return { ok: false, reason: 'capture_not_found', leftFound: Boolean(left), rightFound: Boolean(right) };
    }
    if (!left.text || !right.text) {
      return { ok: false, reason: 'only_text_read_write_svc_is_supported' };
    }
    const leftParsed = this.parseReadWriteSvc(left.text);
    const rightParsed = this.parseReadWriteSvc(right.text);
    if (!leftParsed || !rightParsed) {
      return { ok: false, reason: 'not_read_write_svc' };
    }

    const leftServices = this.flattenReadWriteServices(leftParsed);
    const rightServices = this.flattenReadWriteServices(rightParsed);
    const serviceKeys = [...new Set([...leftServices.keys(), ...rightServices.keys()])];
    const services = serviceKeys.map((key) => {
      const leftCmd = leftServices.get(key);
      const rightCmd = rightServices.get(key);
      const leftBytes = leftCmd?.b64dat ? Buffer.from(leftCmd.b64dat, 'base64') : Buffer.alloc(0);
      const rightBytes = rightCmd?.b64dat ? Buffer.from(rightCmd.b64dat, 'base64') : Buffer.alloc(0);
      return {
        key,
        service: leftCmd?.service ?? rightCmd?.service,
        left: leftCmd ? {
          id: leftCmd.id,
          type: leftCmd.type,
          b64Chars: leftCmd.b64dat?.length ?? 0,
          bytes: leftBytes.length,
        } : null,
        right: rightCmd ? {
          id: rightCmd.id,
          type: rightCmd.type,
          b64Chars: rightCmd.b64dat?.length ?? 0,
          bytes: rightBytes.length,
        } : null,
        diff: this.diffBuffers(leftBytes, rightBytes),
      };
    });
    const result = {
      ok: true,
      left: {
        id: left.id,
        bytes: left.bytes,
        commandType: left.commandType,
        labelId: leftParsed.opas[0]?.addr,
        fingerprint: left.fingerprint,
        textChars: left.text.length,
      },
      right: {
        id: right.id,
        bytes: right.bytes,
        commandType: right.commandType,
        labelId: rightParsed.opas[0]?.addr,
        fingerprint: right.fingerprint,
        textChars: right.text.length,
      },
      services,
      sameCapture: left.id === right.id,
      sameFingerprint: left.fingerprint === right.fingerprint,
    };
    this.db.recordRequest({
      method: 'OFFICIAL-WS-DIFF',
      path: `/ap/${apId}/captures/${leftId}/${rightId}`,
      statusCode: 200,
      body: {
        apId,
        leftId,
        rightId,
        services: services.map((service) => ({
          key: service.key,
          leftBytes: service.left?.bytes,
          rightBytes: service.right?.bytes,
          changedBytes: service.diff.changedBytes,
          firstDiff: service.diff.firstDiff,
          ranges: service.diff.ranges.slice(0, 8),
        })),
      },
    });
    return result;
  }

  analyzeOfficialDownlinks(apId: string) {
    const rows = this.db.officialDownlinkCaptures
      .filter((item) => item.apId === apId && item.commandType === 'READ_WRITE_SVC' && item.text)
      .map((capture) => {
        const parsed = this.parseReadWriteSvc(capture.text ?? '');
        const services = parsed ? this.flattenReadWriteServices(parsed) : new Map<string, { id?: unknown; type?: unknown; service?: string; b64dat?: string }>();
        const service03 = [...services.values()].find((service) => service.service === '01-00-00-03' && service.b64dat);
        const service07 = [...services.values()].find((service) => service.service === '01-00-00-07' && service.b64dat);
        const service03Bytes = service03?.b64dat ? Buffer.from(service03.b64dat, 'base64') : undefined;
        const service07Bytes = service07?.b64dat ? Buffer.from(service07.b64dat, 'base64') : undefined;
        return {
          id: capture.id,
          createdAt: capture.createdAt,
          labelId: parsed?.opas?.[0]?.addr ?? capture.labelId,
          bytes: capture.bytes,
          fingerprint: capture.fingerprint,
          service03: service03Bytes ? this.describeServiceBytes(service03Bytes) : undefined,
          service07: service07Bytes ? this.describeServiceBytes(service07Bytes) : undefined,
        };
      })
      .filter((item) => item.service03);

    const groups = new Map<string, {
      sha256: string;
      count: number;
      service03Bytes: number;
      firstSeenAt: string;
      lastSeenAt: string;
      captureIds: string[];
      headHex?: string;
      tailHex?: string;
    }>();
    for (const row of rows) {
      const sha256 = row.service03?.sha256;
      if (!sha256) {
        continue;
      }
      const existing = groups.get(sha256);
      if (existing) {
        existing.count += 1;
        existing.lastSeenAt = row.createdAt;
        existing.captureIds.push(row.id);
        continue;
      }
      groups.set(sha256, {
        sha256,
        count: 1,
        service03Bytes: row.service03?.bytes ?? 0,
        firstSeenAt: row.createdAt,
        lastSeenAt: row.createdAt,
        captureIds: [row.id],
        headHex: row.service03?.headHex,
        tailHex: row.service03?.tailHex,
      });
    }

    return {
      ok: true,
      apId,
      count: rows.length,
      uniqueService03: groups.size,
      groups: [...groups.values()].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt)),
      rows: rows.slice(-80).reverse(),
      note: 'service03 is the rendered screen payload. If service03 sha256 changes when f1 changes, the template variable path is confirmed.',
    };
  }

  analyzeOfficialDownlinkStructure(apId: string, captureIds?: string[]) {
    const captures = this.db.officialDownlinkCaptures
      .filter((item) => item.apId === apId && item.commandType === 'READ_WRITE_SVC' && item.text)
      .filter((item) => !captureIds?.length || captureIds.includes(item.id));

    const service03Bytes = captures
      .map((capture) => {
        const parsed = this.parseReadWriteSvc(capture.text ?? '');
        const services = parsed ? this.flattenReadWriteServices(parsed) : new Map<string, { service?: string; b64dat?: string }>();
        const cmd = [...services.values()].find((service) => service.service === '01-00-00-03' && service.b64dat);
        const bytes = cmd?.b64dat ? Buffer.from(cmd.b64dat, 'base64') : undefined;
        return bytes ? { capture, bytes } : undefined;
      })
      .filter(Boolean) as Array<{ capture: OfficialDownlinkCapture; bytes: Buffer }>;

    if (!service03Bytes.length) {
      return { ok: false, reason: 'no_service03_found', apId, captureCount: captures.length };
    }

    const baseline = service03Bytes[0].bytes;
    const sortedMedian = (values: number[]) => {
      if (!values.length) return 0;
      const sorted = values.slice().sort((left, right) => left - right);
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    };

    // 当只传 1 条 captureIds 时，用“该基线 vs 同 AP 的其它历史捕获”推导封套中位数，避免返回整包长度这种无意义结果。
    const comparePool = (captureIds?.length === 1 && service03Bytes.length === 1)
      ? this.db.officialDownlinkCaptures
        .filter((item) => item.apId === apId && item.commandType === 'READ_WRITE_SVC' && item.text && item.id !== captureIds[0])
        .map((capture) => {
          const parsed = this.parseReadWriteSvc(capture.text ?? '');
          const services = parsed ? this.flattenReadWriteServices(parsed) : new Map<string, { service?: string; b64dat?: string }>();
          const cmd = [...services.values()].find((service) => service.service === '01-00-00-03' && service.b64dat);
          const bytes = cmd?.b64dat ? Buffer.from(cmd.b64dat, 'base64') : undefined;
          return bytes ? { capture, bytes } : undefined;
        })
        .filter(Boolean) as Array<{ capture: OfficialDownlinkCapture; bytes: Buffer }>
      : service03Bytes;

    const prefixCandidates = comparePool.map((item) => this.commonPrefixBytes(baseline, item.bytes)).filter((value) => value > 0);
    const commonPrefix = sortedMedian(prefixCandidates);
    const suffixCandidates = comparePool
      .map((item) => this.commonSuffixBytes(baseline, item.bytes, commonPrefix))
      .filter((value) => value > 0);
    const commonSuffix = sortedMedian(suffixCandidates);

    const guessDecoded = (payload: Buffer) => {
      const attempts: Array<{ format: string; bytes?: Buffer; error?: string }> = [];
      const push = (format: string, fn: () => Buffer) => {
        try {
          attempts.push({ format, bytes: fn() });
        } catch (error) {
          attempts.push({ format, error: error instanceof Error ? error.message : String(error) });
        }
      };

      // gzip magic 1f8b
      if (payload.length >= 2 && payload[0] === 0x1f && payload[1] === 0x8b) {
        push('gzip', () => gunzipSync(payload));
      }

      // zlib header typically 0x78 0x01/0x9c/0xda
      if (payload.length >= 2 && payload[0] === 0x78) {
        push('zlib.inflate', () => inflateSync(payload));
      }

      // raw deflate fallback
      push('deflateRaw', () => inflateRawSync(payload));

      const decoded = attempts.find((item) => item.bytes)?.bytes;
      if (!decoded) {
        return { compression: 'unknown', decodedBytes: 0, attempts };
      }

      const expected = {
        bw_1bpp_296x128: 296 * 128 / 8,
        bwr_2plane_296x128: (296 * 128 / 8) * 2,
        gray8_296x128: 296 * 128,
        rgba_296x128: 296 * 128 * 4,
      };
      const candidates = Object.entries(expected)
        .map(([name, size]) => ({ name, size, delta: Math.abs(decoded.length - size) }))
        .sort((a, b) => a.delta - b.delta)
        .slice(0, 4);

      return {
        compression: attempts.find((item) => item.bytes)?.format ?? 'unknown',
        decodedBytes: decoded.length,
        decodedHeadHex: decoded.subarray(0, 32).toString('hex'),
        decodedTailHex: decoded.subarray(Math.max(0, decoded.length - 32)).toString('hex'),
        candidates,
        attempts: attempts.map((item) => ({ format: item.format, ok: Boolean(item.bytes), decodedBytes: item.bytes?.length, error: item.error })),
      };
    };

    const samples = service03Bytes.slice(-24).map((item) => ({
      id: item.capture.id,
      createdAt: item.capture.createdAt,
      bytes: item.bytes.length,
      headHex: item.bytes.subarray(0, 32).toString('hex'),
      tailHex: item.bytes.subarray(Math.max(0, item.bytes.length - 32)).toString('hex'),
      structure: {
        commonPrefixBytes: commonPrefix,
        commonSuffixBytes: commonSuffix,
        variableBytes: Math.max(0, item.bytes.length - commonPrefix - commonSuffix),
        // 一般 service03 的“图片主体”就在中间可变段里，这里直接把中间段也给出解码猜测
        middle: guessDecoded(item.bytes.subarray(commonPrefix, item.bytes.length - commonSuffix)),
      },
    }));

    return {
      ok: true,
      apId,
      captureCount: captures.length,
      service03Count: service03Bytes.length,
      commonPrefixBytes: commonPrefix,
      commonSuffixBytes: commonSuffix,
      note: '中间段（剔除共同前后缀）通常是图像payload；解码尝试按 gzip / zlib / deflateRaw 顺序猜测。',
      samples,
    };
  }

  sendRaw(apId: string, payload: unknown) {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const summary = summarizeOutboundText(text);
    const trace = this.createDownlinkTrace(apId, 'websocket-text', {
      bytes: Buffer.byteLength(text),
      ...this.extractCommandMeta(payload),
    });
    const status = this.getConnectionStatus(apId);
    if (!status.connected) {
      this.updateDownlinkTrace(trace.id, 'socket_missing', { error: 'AP websocket is not connected' });
      return {
        ok: false,
        trackingId: trace.id,
        reason: 'AP websocket is not connected',
      };
    }

    const ws = this.activeSockets.get(apId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.updateDownlinkTrace(trace.id, 'socket_missing', { error: 'AP websocket is not connected' });
      return {
        ok: false,
        trackingId: trace.id,
        reason: 'AP websocket is not connected',
      };
    }

    this.updateDownlinkTrace(trace.id, 'socket_write_pending');
    ws.send(text, (error) => {
      this.updateDownlinkTrace(trace.id, error ? 'socket_write_error' : 'socket_write_ok', {
        error: error ? error.message : undefined,
      });
      this.db.recordRequest({
        method: 'WS-SEND-CALLBACK',
        path: '/ws',
        statusCode: error ? 502 : 200,
        body: {
          trackingId: trace.id,
          apId,
          bytes: Buffer.byteLength(text),
          ok: !error,
          error: error?.message,
          meaning: error
            ? 'WebSocket send callback failed before the frame could be handed to the socket.'
            : 'Frame was handed to the WebSocket socket. This is not an AP execution ACK.',
        },
      });
    });
    this.db.recordRequest({
      method: 'WS-OUT',
      path: '/ws',
      statusCode: 200,
      body: { trackingId: trace.id, apId, ...summary },
    });
    return {
      ok: true,
      trackingId: trace.id,
      bytes: Buffer.byteLength(text),
      ...summary,
      execution: 'unconfirmed',
      message: 'WebSocket frame sent; waiting for a device execution ACK from the AP firmware.',
    };
  }

  sendBinary(apId: string, payload: Buffer | Uint8Array, meta: Record<string, unknown> = {}) {
    const bytes = Buffer.from(payload);
    const trace = this.createDownlinkTrace(apId, 'websocket-binary', {
      bytes: bytes.length,
      commandType: typeof meta.type === 'string' ? meta.type : undefined,
      labelId: typeof meta.labelId === 'string' ? meta.labelId : undefined,
      topic: typeof meta.topic === 'string' ? meta.topic : undefined,
    });
    const status = this.getConnectionStatus(apId);
    if (!status.connected) {
      this.updateDownlinkTrace(trace.id, 'socket_missing', { error: 'AP websocket is not connected' });
      return {
        ok: false,
        trackingId: trace.id,
        reason: 'AP websocket is not connected',
      };
    }

    const ws = this.activeSockets.get(apId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.updateDownlinkTrace(trace.id, 'socket_missing', { error: 'AP websocket is not connected' });
      return {
        ok: false,
        trackingId: trace.id,
        reason: 'AP websocket is not connected',
      };
    }

    this.updateDownlinkTrace(trace.id, 'socket_write_pending');
    ws.send(bytes, (error) => {
      this.updateDownlinkTrace(trace.id, error ? 'socket_write_error' : 'socket_write_ok', {
        error: error ? error.message : undefined,
      });
      this.db.recordRequest({
        method: 'WS-SEND-CALLBACK',
        path: '/ws',
        statusCode: error ? 502 : 200,
        body: {
          trackingId: trace.id,
          apId,
          bytes: bytes.length,
          ok: !error,
          error: error?.message,
          ...meta,
          meaning: error
            ? 'Binary WebSocket send callback failed before the frame could be handed to the socket.'
            : 'Binary frame was handed to the WebSocket socket. This is not an AP execution ACK.',
        },
      });
    });
    this.db.recordRequest({
      method: 'WS-OUT-BINARY',
      path: '/ws',
      statusCode: 200,
      body: { trackingId: trace.id, apId, bytes: bytes.length, ...meta },
    });
    return {
      ok: true,
      trackingId: trace.id,
      bytes: bytes.length,
      execution: 'unconfirmed',
      message: 'Binary WebSocket frame sent; waiting for AP firmware result.',
    };
  }

  forwardMqttCommand(topic: string, parsed: unknown) {
    const match = topic.match(/^([^/]+)\/([^/]+)\/cmd$/);
    if (!match) {
      return;
    }

    const [, storeCode, apId] = match;
    const result = this.sendRaw(apId, parsed);
    this.db.recordRequest({
      method: 'MQTT-BRIDGE-WS',
      path: topic,
      statusCode: result.ok ? 200 : 503,
      body: {
        storeCode,
        apId,
        ok: result.ok,
        reason: result.ok ? undefined : result.reason,
        bytes: 'bytes' in result ? result.bytes : undefined,
        message: result.ok
          ? 'MQTT cmd was forwarded to the AP WebSocket connection.'
          : 'MQTT cmd was received, but the AP WebSocket was not connected.',
      },
    });
  }

  private createDownlinkTrace(apId: string, transport: DownlinkTrace['transport'], patch: Partial<DownlinkTrace> = {}) {
    const now = new Date().toISOString();
    const trace: DownlinkTrace = {
      id: `down_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      apId,
      transport,
      direction: 'cloud_to_ap',
      createdAt: now,
      updatedAt: now,
      status: 'socket_write_pending',
      ...patch,
    };
    this.downlinkTraces.push(trace);
    if (this.downlinkTraces.length > 300) {
      this.downlinkTraces.splice(0, this.downlinkTraces.length - 300);
    }
    this.db.recordRequest({
      method: 'DOWNLINK-TRACE',
      path: `/ap/${apId}`,
      statusCode: 102,
      body: trace,
    });
    return trace;
  }

  private captureOfficialDownlink(
    message: RawData,
    isBinary: boolean,
    targetUrl: string,
    context: ApSocketContext,
    summary: Record<string, unknown>,
  ) {
    const bytes = Buffer.isBuffer(message)
      ? message
      : Array.isArray(message)
        ? Buffer.concat(message)
        : Buffer.from(message as ArrayBuffer);
    const text = isBinary ? undefined : bytes.toString('utf8');
    const meta = text ? this.extractCommandMetaFromText(text) : {};
    const replayable = Boolean(
      context.apId &&
      bytes.length > 0 &&
      text !== 'pong' &&
      text !== 'ping',
    );
    const capture: OfficialDownlinkCapture = {
      id: `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      apId: context.apId ?? 'unknown-ap',
      storeCode: context.storeCode,
      targetUrl,
      createdAt: new Date().toISOString(),
      kind: isBinary ? 'binary' : 'text',
      bytes: bytes.length,
      replayable,
      text,
      base64: isBinary ? bytes.toString('base64') : undefined,
      hexPrefix: bytes.subarray(0, 96).toString('hex'),
      commandType: meta.commandType,
      labelId: meta.labelId,
      queueId: meta.queueId,
      fingerprint: this.fingerprintPayload(bytes),
      summary,
    };
    this.db.officialDownlinkCaptures.push(capture);
    if (this.db.officialDownlinkCaptures.length > 200) {
      this.db.officialDownlinkCaptures.splice(0, this.db.officialDownlinkCaptures.length - 200);
    }
    this.db.save();
    this.db.recordRequest({
      method: 'OFFICIAL-WS-CAPTURE',
      path: targetUrl,
      statusCode: replayable ? 200 : 204,
      body: {
        id: capture.id,
        apId: capture.apId,
        storeCode: capture.storeCode,
        kind: capture.kind,
        bytes: capture.bytes,
        replayable: capture.replayable,
        commandType: capture.commandType,
        labelId: capture.labelId,
        queueId: capture.queueId,
        fingerprint: capture.fingerprint,
        summary,
      },
    });
    return capture;
  }

  private extractCommandMetaFromText(text: string) {
    if (!text.startsWith('{')) {
      return {};
    }
    try {
      return this.extractCommandMeta(JSON.parse(text) as Record<string, unknown>);
    } catch {
      return {};
    }
  }

  private fingerprintPayload(bytes: Buffer) {
    let hash = 2166136261;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  private describeServiceBytes(bytes: Buffer) {
    return {
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      fnv: this.fingerprintPayload(bytes),
      headHex: bytes.subarray(0, 24).toString('hex'),
      tailHex: bytes.subarray(-24).toString('hex'),
    };
  }

  private parseReadWriteSvc(text: string) {
    try {
      const parsed = JSON.parse(text) as { type?: string; opas?: Array<{ addr?: string; cmds?: Array<Record<string, unknown>> }> };
      if (parsed.type !== 'READ_WRITE_SVC' || !Array.isArray(parsed.opas)) {
        return undefined;
      }
      return parsed as { type: string; opas: Array<{ addr?: string; cmds?: Array<Record<string, unknown>> }> };
    } catch {
      return undefined;
    }
  }

  private flattenReadWriteServices(parsed: { opas?: Array<{ addr?: string; cmds?: Array<Record<string, unknown>> }> }) {
    const services = new Map<string, { id?: unknown; type?: unknown; service?: string; b64dat?: string }>();
    const occurrences = new Map<string, number>();
    for (const [opaIndex, opa] of (parsed.opas ?? []).entries()) {
      for (const [cmdIndex, cmd] of (opa.cmds ?? []).entries()) {
        const service = typeof cmd.service === 'string' ? cmd.service : `no-service-${cmdIndex}`;
        const type = typeof cmd.type === 'string' ? cmd.type : 'UNKNOWN';
        const occurrenceBase = `${opaIndex}:${service}:${type}`;
        const occurrence = occurrences.get(occurrenceBase) ?? 0;
        occurrences.set(occurrenceBase, occurrence + 1);
        services.set(`${occurrenceBase}:${occurrence}`, {
          id: cmd.id,
          type,
          service,
          b64dat: typeof cmd.b64dat === 'string' ? cmd.b64dat : undefined,
        });
      }
    }
    return services;
  }

  private diffBuffers(left: Buffer, right: Buffer) {
    const max = Math.max(left.length, right.length);
    const commonPrefixBytes = this.commonPrefixBytes(left, right);
    const commonSuffixBytes = this.commonSuffixBytes(left, right, commonPrefixBytes);
    let equalBytes = 0;
    let changedBytes = 0;
    let firstDiff: number | undefined;
    const ranges: Array<{
      start: number;
      end: number;
      length: number;
      leftHex: string;
      rightHex: string;
      leftAscii: string;
      rightAscii: string;
    }> = [];
    let rangeStart: number | undefined;

    for (let index = 0; index < max; index += 1) {
      const same = index < left.length && index < right.length && left[index] === right[index];
      if (same) {
        equalBytes += 1;
        if (rangeStart !== undefined) {
          this.pushDiffRange(ranges, left, right, rangeStart, index);
          rangeStart = undefined;
        }
        continue;
      }
      changedBytes += 1;
      firstDiff ??= index;
      rangeStart ??= index;
    }
    if (rangeStart !== undefined) {
      this.pushDiffRange(ranges, left, right, rangeStart, max);
    }

    return {
      leftBytes: left.length,
      rightBytes: right.length,
      equalBytes,
      changedBytes,
      firstDiff,
      commonPrefixBytes,
      commonSuffixBytes,
      leftVariableBytes: Math.max(0, left.length - commonPrefixBytes - commonSuffixBytes),
      rightVariableBytes: Math.max(0, right.length - commonPrefixBytes - commonSuffixBytes),
      changedRatio: max === 0 ? 0 : Number((changedBytes / max).toFixed(4)),
      ranges: ranges.slice(0, 24),
    };
  }

  private commonPrefixBytes(left: Buffer, right: Buffer) {
    const limit = Math.min(left.length, right.length);
    let index = 0;
    while (index < limit && left[index] === right[index]) {
      index += 1;
    }
    return index;
  }

  private commonSuffixBytes(left: Buffer, right: Buffer, skipPrefix = 0) {
    const limit = Math.min(left.length, right.length) - skipPrefix;
    let index = 0;
    while (
      index < limit
      && left[left.length - 1 - index] === right[right.length - 1 - index]
    ) {
      index += 1;
    }
    return index;
  }

  private pushDiffRange(
    ranges: Array<{ start: number; end: number; length: number; leftHex: string; rightHex: string; leftAscii: string; rightAscii: string }>,
    left: Buffer,
    right: Buffer,
    start: number,
    end: number,
  ) {
    const previewStart = Math.max(0, start - 12);
    const previewEnd = Math.min(Math.max(left.length, right.length), end + 20);
    ranges.push({
      start,
      end: end - 1,
      length: end - start,
      leftHex: left.subarray(previewStart, Math.min(previewEnd, left.length)).toString('hex'),
      rightHex: right.subarray(previewStart, Math.min(previewEnd, right.length)).toString('hex'),
      leftAscii: this.asciiPreview(left.subarray(previewStart, Math.min(previewEnd, left.length))),
      rightAscii: this.asciiPreview(right.subarray(previewStart, Math.min(previewEnd, right.length))),
    });
  }

  private asciiPreview(buffer: Buffer) {
    return [...buffer].map((byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join('');
  }

  private updateDownlinkTrace(id: string, status: DownlinkTrace['status'], patch: Partial<DownlinkTrace> = {}) {
    const trace = this.downlinkTraces.find((item) => item.id === id);
    if (!trace) {
      return;
    }
    Object.assign(trace, patch, {
      status,
      updatedAt: new Date().toISOString(),
    });
    this.db.recordRequest({
      method: 'DOWNLINK-TRACE',
      path: `/ap/${trace.apId}`,
      statusCode: status === 'socket_write_error' || status === 'socket_missing' ? 503 : 200,
      body: trace,
    });
    this.updateTaskFromDownlinkTrace(trace);
  }

  private updateTaskFromDownlinkTrace(trace: DownlinkTrace) {
    const task = [...this.db.cloudTasks.values()].find((item) => {
      const delivery = item.delivery && typeof item.delivery === 'object' ? item.delivery as Record<string, unknown> : undefined;
      const websocket = delivery?.websocket && typeof delivery.websocket === 'object' ? delivery.websocket as Record<string, unknown> : undefined;
      return websocket?.trackingId === trace.id;
    });
    if (!task) return;

    const events = Array.isArray(task.events) ? task.events as Array<Record<string, unknown>> : [];
    const reply = trace.reply && typeof trace.reply === 'object' ? trace.reply as Record<string, unknown> : undefined;
    const payload = reply?.payload && typeof reply.payload === 'object' ? reply.payload as Record<string, unknown> : undefined;
    const cmd = payload?.cmd && typeof payload.cmd === 'object' ? payload.cmd as Record<string, unknown> : undefined;
    const res = payload?.res && typeof payload.res === 'object' ? payload.res as Record<string, unknown> : undefined;
    const rawCmdType = typeof payload?.cmd === 'string' ? payload.cmd : undefined;
    const replyType = String(reply?.type ?? payload?.type ?? '');
    const cmdType = String(reply?.cmdType ?? cmd?.type ?? rawCmdType ?? '');
    const toNumber = (...values: unknown[]) => {
      for (const value of values) {
        const num = Number(value);
        if (Number.isFinite(num)) {
          return num;
        }
      }
      return undefined;
    };
    const errno = toNumber(payload?.errno, payload?.errcode, payload?.error_no, payload?.err_no, res?.errno, res?.errcode, res?.error_no, res?.err_no, cmd?.errno, cmd?.errcode);
    const ack = toNumber(payload?.ack_pkt_num, payload?.ackPktNum, payload?.ack_pkt, payload?.ack, res?.ack_pkt_num, res?.ackPktNum, res?.ack_pkt, res?.ack, cmd?.ack_pkt_num, cmd?.ackPktNum, cmd?.ack_pkt, cmd?.ack);
    const send = toNumber(payload?.send_pkt_num, payload?.sendPktNum, payload?.send_pkt, payload?.send, res?.send_pkt_num, res?.sendPktNum, res?.send_pkt, res?.send, cmd?.send_pkt_num, cmd?.sendPktNum, cmd?.send_pkt, cmd?.send);
    const writeMs = toNumber(payload?.write_time_ms, payload?.writeTimeMs, payload?.write_ms, payload?.write, res?.write_time_ms, res?.writeTimeMs, res?.write_ms, res?.write, cmd?.write_time_ms, cmd?.writeTimeMs, cmd?.write_ms, cmd?.write);
    const rwTaskRest = toNumber(payload?.rw_task_rest, payload?.rwTaskRest);
    const ackSendText = `ack/send=${ack ?? '-'} / ${send ?? '-'}`;
    const errnoText = `errno=${errno ?? '-'}`;
    const writeText = writeMs === undefined ? '' : ` · write=${writeMs}ms`;
    const replyPrefix = `trace 状态：${trace.status} · AP 回包：${replyType || '-'}`;

    let nextStatus = String(task.status ?? 'sent');
    let resultMsg = String(task.resultMsg ?? '等待基站返回结果。');

    if (trace.status === 'socket_missing' || trace.status === 'socket_write_error') {
      nextStatus = 'failed';
      resultMsg = `下发失败：${trace.error ?? 'WebSocket 不可用'}`;
    } else if (trace.status === 'socket_write_ok') {
      nextStatus = 'sending';
      resultMsg = `已下发（待执行确认），tracking=${trace.id}`;
    } else if (trace.status === 'ap_reply_seen' && replyType === 'READ_WRITE_SVC' && cmdType === 'WRITE_SVC') {
      const ackSendOk = ack === undefined || send === undefined || ack === send;
      if (errno === 0 && ackSendOk) {
        nextStatus = 'success';
        resultMsg = `执行确认成功：${replyPrefix} · cmd=WRITE_SVC · ${ackSendText} · ${errnoText}${writeText} · 执行确认成功（已收到设备执行结果（errno=0））`;
      } else {
        nextStatus = 'failed';
        const reason = errno !== undefined && errno !== 0
          ? `设备执行失败（errno=${errno}）`
          : ack !== undefined && send !== undefined && ack !== send
            ? '设备确认包数量不一致'
            : '设备执行结果异常';
        resultMsg = `执行确认失败：${replyPrefix} · cmd=WRITE_SVC · ${ackSendText} · ${errnoText}${writeText} · ${reason}`;
      }
    } else if (trace.status === 'ap_reply_seen' && replyType === 'AP_REPORT_STATUS') {
      if (rwTaskRest === 0) {
        const elapsedMs = Date.now() - new Date(trace.createdAt).getTime();
        if (elapsedMs >= Number(process.env.AP_WRITE_SVC_CONFIRM_TIMEOUT_MS ?? 20_000)) {
          nextStatus = 'timeout';
          resultMsg = `执行确认超时：${replyPrefix} · rw_task_rest=0 · AP 队列已清空，但本次 trace 尚未看到 WRITE_SVC 执行结果`;
        } else {
          nextStatus = 'sending';
          resultMsg = `已下发（待执行确认）：${replyPrefix} · rw_task_rest=0 · AP 队列已清空，继续等待 WRITE_SVC 执行结果`;
        }
      } else {
        nextStatus = 'sending';
        resultMsg = `已下发（待执行确认）：${replyPrefix} · rw_task_rest=${rwTaskRest ?? '-'} · AP 队列仍有任务，继续等待 WRITE_SVC 执行结果`;
      }
    } else if (trace.status === 'ap_reply_seen') {
      nextStatus = 'sending';
      resultMsg = `已收到基站回包但尚未确认执行结果：${replyPrefix} · 等待 READ_WRITE_SVC / WRITE_SVC`;
    }

    task.status = nextStatus;
    task.resultMsg = resultMsg;
    task.updatedAt = new Date().toISOString();
    task.events = [
      ...events,
      {
        id: `${trace.id}_${trace.updatedAt}`,
        time: trace.updatedAt,
        status: trace.status,
        message: resultMsg,
        trace: {
          id: trace.id,
          transport: trace.transport,
          bytes: trace.bytes,
          commandType: trace.commandType,
          labelId: trace.labelId,
          queueId: trace.queueId,
          reply,
          error: trace.error,
        },
      },
    ].slice(-30);
    task.delivery = {
      ...(task.delivery && typeof task.delivery === 'object' ? task.delivery as Record<string, unknown> : {}),
      downlinkTrace: trace,
    };
    this.db.cloudTasks.set(String(task.id), task);
    this.db.save();
  }

  private extractCommandMeta(payload: unknown) {
    if (!payload || typeof payload !== 'object') {
      return {};
    }
    const command = payload as Record<string, unknown>;
    if (command.type === 'READ_WRITE_SVC' && Array.isArray(command.opas)) {
      const firstOpa = command.opas.find((item) => item && typeof item === 'object') as Record<string, unknown> | undefined;
      return {
        commandType: 'READ_WRITE_SVC',
        labelId: typeof firstOpa?.addr === 'string' ? firstOpa.addr : undefined,
      };
    }
    const data = command.data && typeof command.data === 'object' ? command.data as Record<string, unknown> : undefined;
    const img = data?.img && typeof data.img === 'object' ? data.img as Record<string, unknown> : undefined;
    const led = data?.led && typeof data.led === 'object' ? data.led as Record<string, unknown> : undefined;
    const ndef = data?.ndef && typeof data.ndef === 'object' ? data.ndef as Record<string, unknown> : undefined;
    const queueId = Number(img?.queue_id ?? led?.queue_id ?? ndef?.queue_id ?? data?.queue_id);
    return {
      commandType: typeof command.type === 'string' ? command.type : undefined,
      labelId: typeof data?.esl_code === 'string' ? data.esl_code : undefined,
      queueId: Number.isFinite(queueId) ? queueId : undefined,
    };
  }

  private observeApReply(text: string, context?: ApSocketContext) {
    if (!context?.apId || text === 'ping') {
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = typeof parsed.type === 'string' ? parsed.type : '';
    const data = parsed.data && typeof parsed.data === 'object' ? parsed.data as Record<string, unknown> : undefined;
    const cmd = parsed.cmd && typeof parsed.cmd === 'object' ? parsed.cmd as Record<string, unknown> : undefined;
    const cmdType = typeof cmd?.type === 'string' ? cmd.type : undefined;
    const addr = typeof parsed.addr === 'string' ? parsed.addr : undefined;
    const replyLabelId = addr ? addr.slice(0, 8) : undefined;
    const queueId = Number(parsed.queue_id ?? data?.queue_id);
    const looksLikeAck = /ACK|RESULT|REPORT|STATUS|WRITE|ERROR|FAIL/i.test(type);
    const recent = this.downlinkTraces
      .filter((trace) => trace.apId === context.apId && Date.now() - new Date(trace.createdAt).getTime() < 120_000)
      .filter((trace) => !Number.isFinite(queueId) || trace.queueId === queueId || !trace.queueId)
      .filter((trace) => !replyLabelId || !trace.labelId || trace.labelId === replyLabelId)
      .slice(-10);

    if (type === 'AP_REPORT_STATUS') {
      this.db.recordRequest({
        method: 'AP-QUEUE-STATUS',
        path: `/ap/${context.apId}`,
        statusCode: 200,
        body: {
          apId: context.apId,
          rw_task_rest: parsed.rw_task_rest,
          recentDownlinks: recent.map((trace) => ({
            id: trace.id,
            status: trace.status,
            commandType: trace.commandType,
            labelId: trace.labelId,
            queueId: trace.queueId,
            secondsAgo: Math.round((Date.now() - new Date(trace.createdAt).getTime()) / 1000),
          })),
          meaning: 'AP reported its read/write task queue depth. If this stays 0 after downlink, the AP did not accept a write task.',
        },
      });
    }

    if (!looksLikeAck) {
      return;
    }

    // READ_WRITE_SVC 的 CONN_DEV / DIS_CONN 不是刷图执行结果，避免误绑定到当前 trace。
    if (type === 'READ_WRITE_SVC' && cmdType && cmdType !== 'WRITE_SVC') {
      return;
    }

    for (const trace of recent) {
      // 如果 trace 已经拿到 WRITE_SVC 回包，就不要再用 AP_REPORT_STATUS 覆盖掉它。
      const existingReply = trace.reply && typeof trace.reply === 'object' ? trace.reply as Record<string, unknown> : undefined;
      const existingPayload = existingReply?.payload && typeof existingReply.payload === 'object'
        ? existingReply.payload as Record<string, unknown>
        : undefined;
      const existingType = typeof existingPayload?.type === 'string' ? existingPayload.type : undefined;
      const existingCmd = existingPayload?.cmd && typeof existingPayload.cmd === 'object'
        ? existingPayload.cmd as Record<string, unknown>
        : undefined;
      const existingCmdType = typeof existingCmd?.type === 'string' ? existingCmd.type : undefined;
      if (type === 'AP_REPORT_STATUS' && existingType === 'READ_WRITE_SVC' && existingCmdType === 'WRITE_SVC') {
        continue;
      }

      this.updateDownlinkTrace(trace.id, 'ap_reply_seen', {
        reply: {
          type,
          cmdType,
          labelId: replyLabelId,
          queueId: Number.isFinite(queueId) ? queueId : undefined,
          payload: parsed,
        },
      });
    }
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

  private async bridgeUplinkToMqtt(text: string, ws: WebSocket) {
    if (text === 'ping') {
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }

    const context = this.socketContexts.get(ws);
    const type = typeof parsed.type === 'string' ? parsed.type : 'UNKNOWN';
    const apId = this.pickApId(parsed, context);
    const storeCode = this.pickStoreCode(parsed, context);
    const envelope = {
      direction: 'ap_to_cloud',
      receivedAt: new Date().toISOString(),
      apId,
      storeCode,
      type,
      payload: parsed,
    };

    try {
      await this.mqtt.publishJson(`stores/${storeCode}/aps/${apId}/uplink`, envelope, { retain: true });
      await this.mqtt.publishJson(`stores/${storeCode}/aps/${apId}/events/${type}`, envelope, { retain: true });

      if (type === 'DEVICE_RETRIEVE' && parsed.data && typeof parsed.data === 'object') {
        for (const [labelId, payload] of Object.entries(parsed.data as Record<string, unknown>)) {
          await this.mqtt.publishJson(`stores/${storeCode}/labels/${labelId}/events`, {
            ...envelope,
            labelId,
            payload,
          }, { retain: true });
        }
      }

      if (type === 'SLAVE_ADV_SVC' && typeof parsed.addr === 'string') {
        const labelId = parsed.addr.slice(0, 8);
        await this.mqtt.publishJson(`stores/${storeCode}/labels/${labelId}/events`, {
          ...envelope,
          labelId,
        }, { retain: true });
      }
    } catch (error) {
      this.logger.warn(`Failed to bridge AP uplink to MQTT: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private pickStoreCode(parsed: Record<string, unknown>, context?: ApSocketContext) {
    return String(parsed.store_code ?? context?.storeCode ?? process.env.UPSTREAM_STORE_CODE ?? '20248517');
  }

  private pickApId(parsed: Record<string, unknown>, context?: ApSocketContext) {
    const raw = parsed.ap_code ?? parsed.mac ?? context?.apId ?? [...this.db.baseStations.values()].find((item) => item.status === 'online')?.id;
    return normalizeMac(String(raw ?? 'unknown-ap')) ?? 'unknown-ap';
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
      const currentRow = (current ?? {}) as Label & Record<string, unknown>;
      const label: Label & Record<string, unknown> = {
        ...currentRow,
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
    const currentRow = (current ?? {}) as Label & Record<string, unknown>;
    const services = Object.fromEntries((message.service_list ?? []).map((item) => [item.service ?? 'unknown', item.b64dat ?? '']));
    this.db.labels.set(labelId, {
      ...currentRow,
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
