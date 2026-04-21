import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as bcrypt from 'bcryptjs';
import { BaseStation, EslCommand, Label, RequestLog, StoreConfig } from './models';

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

@Injectable()
export class MemoryStore {
  private readonly filePath = join(process.cwd(), 'data', 'store.json');
  readonly stores = new Map<string, StoreConfig>();
  readonly baseStations = new Map<string, BaseStation>();
  readonly labels = new Map<string, Label>();
  readonly commands = new Map<string, EslCommand>();
  readonly requestLogs: RequestLog[] = [];
  readonly apSessions = new Map<string, { storeCode: string; apId: string; createdAt: string }>();

  constructor() {
    if (this.load()) {
      return;
    }

    const storeCode = process.env.UPSTREAM_STORE_CODE ?? '20248517';
    const passwordHash = bcrypt.hashSync('admin123456', 10);

    this.stores.set(storeCode, {
      id: id('store'),
      code: storeCode,
      name: 'Default ESL Store',
      username: 'admin',
      passwordHash,
      serverUrl: process.env.PUBLIC_SERVER_URL ?? 'http://localhost:4000',
      mqttTcpPort: Number(process.env.MQTT_TCP_PORT ?? 1883),
      mqttWsPath: process.env.MQTT_WS_PATH ?? '/mqtt',
      createdAt: now(),
      updatedAt: now(),
    });

    this.baseStations.set('ap-demo-001', {
      id: 'ap-demo-001',
      storeCode,
      name: 'Demo Base Station',
      mac: 'ESLAP-DEMO-001',
      ip: '192.168.1.88',
      firmware: 'v2.x',
      status: 'offline',
      metrics: { labelsOnline: 0, labelsTotal: 2 },
    });

    this.labels.set('label-demo-001', {
      id: 'label-demo-001',
      storeCode,
      apId: 'ap-demo-001',
      sku: 'SKU-001',
      title: 'Demo Product',
      price: 19.9,
      currency: 'CNY',
      status: 'idle',
      battery: 98,
      updatedAt: now(),
    });

    this.save();
  }

  createCommand(input: Omit<EslCommand, 'id' | 'status' | 'createdAt'>) {
    const command: EslCommand = {
      ...input,
      id: id('cmd'),
      status: 'queued',
      createdAt: now(),
    };
    this.commands.set(command.id, command);
    this.save();
    return command;
  }

  recordRequest(input: Omit<RequestLog, 'id' | 'time'>) {
    const log: RequestLog = {
      ...input,
      id: id('req'),
      time: now(),
    };
    this.requestLogs.unshift(log);
    this.requestLogs.splice(1000);
    this.save();
    return log;
  }

  registerApSession(token: string, storeCode: string, apId: string) {
    this.apSessions.set(token, { storeCode, apId, createdAt: now() });
  }

  save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(
      this.filePath,
      JSON.stringify(
        {
          stores: [...this.stores.values()],
          baseStations: [...this.baseStations.values()],
          labels: [...this.labels.values()],
          commands: [...this.commands.values()],
          requestLogs: this.requestLogs,
        },
        null,
        2,
      ),
    );
  }

  private load() {
    if (!existsSync(this.filePath)) {
      return false;
    }

    const data = JSON.parse(readFileSync(this.filePath, 'utf8')) as {
      stores?: StoreConfig[];
      baseStations?: BaseStation[];
      labels?: Label[];
      commands?: EslCommand[];
      requestLogs?: RequestLog[];
    };

    data.stores?.forEach((item) => this.stores.set(item.code, item));
    data.baseStations?.forEach((item) => this.baseStations.set(item.id, item));
    data.labels?.forEach((item) => this.labels.set(item.id, item));
    data.commands?.forEach((item) => this.commands.set(item.id, item));
    this.requestLogs.push(...(data.requestLogs ?? []));
    return true;
  }
}
