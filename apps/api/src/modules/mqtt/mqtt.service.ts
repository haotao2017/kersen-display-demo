import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Aedes, { AedesPublishPacket, Client, createBroker } from 'aedes';
import { createServer, Server } from 'node:net';
import { createServer as createHttpServer, Server as HttpServer } from 'node:http';
import * as websocketStream from 'websocket-stream';
import { MemoryStore } from '../../shared/memory-store';
import { EslCommand } from '../../shared/models';

@Injectable()
export class MqttService implements OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private broker?: Aedes;
  private tcpServer?: Server;
  private wsServer?: HttpServer;
  private readonly clients = new Map<string, { connectedAt: string; username?: string }>();

  constructor(private readonly db: MemoryStore) {}

  async start() {
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
    return {
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
  }

  private async publish(topic: string, payload: string) {
    if (!this.broker) {
      throw new Error('MQTT broker is not started');
    }

    await new Promise<void>((resolve, reject) => {
      this.broker?.publish({ cmd: 'publish', topic, payload: Buffer.from(payload), qos: 1, retain: false, dup: false }, (error) => {
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

  async onModuleDestroy() {
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
