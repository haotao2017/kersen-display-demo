import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Aedes, { AedesPublishPacket, Client, createBroker } from 'aedes';
import { connect as connectTcp, createServer, Server, Socket } from 'node:net';
import { createServer as createHttpServer, Server as HttpServer } from 'node:http';
import { connect as connectTls } from 'node:tls';
import { generate, parser } from 'mqtt-packet';
import * as websocketStream from 'websocket-stream';
import { MemoryStore } from '../../shared/memory-store';
import { EslCommand } from '../../shared/models';
import { loadEnvFiles } from '../../shared/load-env';

type MqttMode = 'embedded' | 'external';

@Injectable()
export class MqttService implements OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private broker?: Aedes;
  private tcpServer?: Server;
  private wsServer?: HttpServer;
  private externalSocket?: Socket;
  private externalConnected = false;
  private externalConnecting?: Promise<void>;
  private externalPingTimer?: ReturnType<typeof setInterval>;
  private readonly clients = new Map<string, { connectedAt: string; username?: string }>();

  constructor(private readonly db: MemoryStore) {}

  async start() {
    loadEnvFiles();

    if (this.mode() === 'external') {
      await this.connectExternal();
      return;
    }

    if (this.broker) {
      return;
    }

    this.broker = createBroker();
    this.broker.authenticate = (client, username, password, done) => {
      const store = [...this.db.stores.values()].find((item) => item.code === username || item.username === username);
      if (!store) {
        done(null, false);
        return;
      }
      if (password?.toString()) {
        done(null, true);
        return;
      }
      done(null, true);
    };

    this.broker.on('client', (client) => {
      this.clients.set(client.id, { connectedAt: new Date().toISOString() });
      this.logger.log(`MQTT client connected: ${client.id}`);
    });

    this.broker.on('clientDisconnect', (client) => {
      this.clients.delete(client.id);
      this.logger.log(`MQTT client disconnected: ${client.id}`);
    });

    this.broker.on('publish', (packet, client) => this.handlePublish(packet, client));

    const tcpPort = Number(process.env.MQTT_TCP_PORT ?? 1883);
    this.tcpServer = createServer(this.broker.handle);
    await new Promise<void>((resolve) => this.tcpServer?.listen(tcpPort, resolve));

    const wsPort = Number(process.env.API_PORT ?? 4000) + 1;
    this.wsServer = createHttpServer();
    websocketStream.createServer({ server: this.wsServer, path: process.env.MQTT_WS_PATH ?? '/mqtt' }, this.broker.handle);
    await new Promise<void>((resolve) => this.wsServer?.listen(wsPort, resolve));

    this.logger.log(`MQTT TCP listening on ${tcpPort}`);
    this.logger.log(`MQTT WebSocket listening on ${wsPort}${process.env.MQTT_WS_PATH ?? '/mqtt'}`);
  }

  stats() {
    loadEnvFiles();

    return {
      mode: this.mode(),
      external: {
        host: process.env.EMQX_HOST,
        port: Number(process.env.EMQX_PORT ?? 1883),
        tls: this.externalTlsEnabled(),
        validateCertificate: this.externalValidateCertificate(),
        connected: this.externalConnected,
        clientId: process.env.EMQX_CLIENT_ID ?? 'kersen-esl-cloud',
      },
      clients: [...this.clients.entries()].map(([id, info]) => ({ id, ...info })),
      tcpPort: Number(process.env.MQTT_TCP_PORT ?? 1883),
      websocketPort: Number(process.env.API_PORT ?? 4000) + 1,
      websocketPath: process.env.MQTT_WS_PATH ?? '/mqtt',
    };
  }

  async publishLabelCommand(command: EslCommand) {
    const topic = `stores/${command.storeCode}/labels/${command.targetId}/commands`;
    const payload = JSON.stringify({
      id: command.id,
      type: command.type,
      payload: command.payload,
      issuedAt: command.createdAt,
    });

    await this.publish(topic, payload);
    command.status = 'sent';
    command.sentAt = new Date().toISOString();
    this.db.commands.set(command.id, command);
    this.db.save();
  }

  async publishJson(topic: string, payload: unknown, options: { retain?: boolean } = {}) {
    await this.publish(topic, JSON.stringify(payload), options);
  }

  private async publish(topic: string, payload: string, options: { retain?: boolean } = {}) {
    if (this.mode() === 'external') {
      await this.publishExternal(topic, payload, options);
      return;
    }

    if (!this.broker) {
      throw new Error('MQTT broker is not started');
    }

    await new Promise<void>((resolve, reject) => {
      this.broker?.publish({ cmd: 'publish', topic, payload: Buffer.from(payload), qos: 1, retain: Boolean(options.retain), dup: false }, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private handlePublish(packet: AedesPublishPacket, client: Client | null) {
    if (!client || packet.topic.startsWith('$SYS')) {
      return;
    }

    const payload = packet.payload?.toString() ?? '';
    const segments = packet.topic.split('/');
    const storeCode = segments[1];
    const resource = segments[2];
    const resourceId = segments[3];
    const event = segments[4];

    if (resource === 'aps' && resourceId && (event === 'heartbeat' || event === 'status')) {
      const current = this.db.baseStations.get(resourceId);
      this.db.baseStations.set(resourceId, {
        id: resourceId,
        storeCode,
        name: current?.name ?? resourceId,
        mac: current?.mac,
        ip: current?.ip,
        firmware: current?.firmware,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        metrics: current?.metrics ?? {},
      });
      this.db.save();
      return;
    }

    if (resource === 'labels' && resourceId && event === 'events') {
      const label = this.db.labels.get(resourceId);
      if (label) {
        this.db.labels.set(resourceId, {
          ...label,
          status: payload.includes('failed') ? 'failed' : 'online',
          updatedAt: new Date().toISOString(),
        });
        this.db.save();
      }
    }
  }

  private mode(): MqttMode {
    return process.env.MQTT_MODE === 'external' ? 'external' : 'embedded';
  }

  private async connectExternal() {
    if (this.externalConnected) {
      return;
    }
    if (this.externalConnecting) {
      return this.externalConnecting;
    }

    const host = process.env.EMQX_HOST;
    if (!host) {
      throw new Error('MQTT_MODE=external requires EMQX_HOST');
    }

    const port = Number(process.env.EMQX_PORT ?? 1883);
    const clientId = process.env.EMQX_CLIENT_ID ?? 'kersen-esl-cloud';
    const username = process.env.EMQX_USERNAME;
    const password = process.env.EMQX_PASSWORD;
    const tls = this.externalTlsEnabled();
    const rejectUnauthorized = this.externalValidateCertificate();

    this.externalConnecting = new Promise<void>((resolve, reject) => {
      const socket = tls ? connectTls({ host, port, servername: host, rejectUnauthorized }) : connectTcp({ host, port });
      const mqttParser = parser();
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`EMQX connect timeout ${host}:${port}`));
      }, 8000);

      mqttParser.on('packet', (packet) => {
        if (packet.cmd === 'connack') {
          clearTimeout(timeout);
          if (packet.returnCode !== 0) {
            socket.destroy();
            reject(new Error(`EMQX connack failed: ${packet.returnCode}`));
            return;
          }
          this.externalSocket = socket;
          this.externalConnected = true;
          this.startExternalPing();
          this.logger.log(`Connected to EMQX ${host}:${port} as ${clientId}${tls ? ' over TLS' : ''}`);
          resolve();
          return;
        }

        if (packet.cmd === 'publish') {
          this.handleExternalPublish(packet.topic, packet.payload?.toString() ?? '');
        }
      });

      socket.on('connect', () => {
        socket.write(generate({
          cmd: 'connect',
          protocolId: 'MQTT',
          protocolVersion: 4,
          clean: true,
          clientId,
          keepalive: 30,
          username,
          password: password ? Buffer.from(password) : undefined,
        }));
      });
      socket.on('data', (chunk) => mqttParser.parse(chunk));
      socket.on('error', (error) => {
        clearTimeout(timeout);
        this.stopExternalPing();
        this.externalConnected = false;
        reject(error);
      });
      socket.on('close', () => {
        this.stopExternalPing();
        this.externalConnected = false;
        this.externalSocket = undefined;
        this.externalConnecting = undefined;
        this.logger.warn('EMQX connection closed');
      });
    }).finally(() => {
      this.externalConnecting = undefined;
    });

    return this.externalConnecting;
  }

  private externalTlsEnabled() {
    return process.env.EMQX_TLS === 'true' || process.env.EMQX_PORT === '8883';
  }

  private externalValidateCertificate() {
    return process.env.EMQX_VALIDATE_CERTIFICATE !== 'false';
  }

  private startExternalPing() {
    this.stopExternalPing();
    this.externalPingTimer = setInterval(() => {
      if (!this.externalSocket || !this.externalConnected) {
        return;
      }
      this.externalSocket.write(generate({ cmd: 'pingreq' }));
    }, 20_000);
  }

  private stopExternalPing() {
    if (!this.externalPingTimer) {
      return;
    }
    clearInterval(this.externalPingTimer);
    this.externalPingTimer = undefined;
  }

  private async publishExternal(topic: string, payload: string, options: { retain?: boolean } = {}) {
    await this.connectExternal();
    if (!this.externalSocket || !this.externalConnected) {
      throw new Error('EMQX is not connected');
    }

    this.externalSocket.write(generate({
      cmd: 'publish',
      topic,
      payload: Buffer.from(payload),
      qos: 0,
      retain: Boolean(options.retain),
      dup: false,
    }));
  }

  private handleExternalPublish(topic: string, payload: string) {
    this.handlePublish({ cmd: 'publish', topic, payload: Buffer.from(payload), qos: 0, retain: false, dup: false } as AedesPublishPacket, {
      id: 'emqx-bridge',
    } as Client);
  }

  async onModuleDestroy() {
    this.stopExternalPing();
    this.externalSocket?.end();
    if (this.tcpServer) {
      await new Promise<void>((resolve) => this.tcpServer?.close(() => resolve()));
    }
    if (this.wsServer) {
      await new Promise<void>((resolve) => this.wsServer?.close(() => resolve()));
    }
    if (this.broker) {
      await new Promise<void>((resolve) => this.broker?.close(() => resolve()));
    }
  }
}
