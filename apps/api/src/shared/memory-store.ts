import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as bcrypt from 'bcryptjs';
import { BaseStation, EslCommand, Label, OfficialDownlinkCapture, RequestLog, StoreConfig } from './models';

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

@Injectable()
export class MemoryStore {
  private readonly filePath = join(process.cwd(), 'data', 'store.json');
  readonly stores = new Map<string, StoreConfig>();
  readonly baseStations = new Map<string, BaseStation>();
  readonly labels = new Map<string, Label>();
  readonly commands = new Map<string, EslCommand>();
  readonly cloudProducts = new Map<string, Record<string, unknown>>();
  readonly cloudTemplates = new Map<string, Record<string, unknown>>();
  readonly cloudTasks = new Map<string, Record<string, unknown>>();
  readonly requestLogs: RequestLog[] = [];
  readonly officialDownlinkCaptures: OfficialDownlinkCapture[] = [];
  readonly apSessions = new Map<string, { storeCode: string; apId: string; createdAt: string; source: 'local' | 'official' }>();
  readonly latestApSessions = new Map<string, { token: string; storeCode: string; apId: string; createdAt: string; source: 'local' | 'official' }>();

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

  registerApSession(token: string, storeCode: string, apId: string, source: 'local' | 'official' = 'local') {
    const session = { storeCode, apId, createdAt: now(), source };
    this.apSessions.set(token, session);
    this.latestApSessions.set(apId, { ...session, token });
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
          cloudProducts: [...this.cloudProducts.values()],
          cloudTemplates: [...this.cloudTemplates.values()],
          cloudTasks: [...this.cloudTasks.values()],
          requestLogs: this.requestLogs,
          officialDownlinkCaptures: this.officialDownlinkCaptures,
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

    let data: {
      stores?: StoreConfig[];
      baseStations?: BaseStation[];
      labels?: Label[];
      commands?: EslCommand[];
      cloudProducts?: Array<Record<string, unknown>>;
      cloudTemplates?: Array<Record<string, unknown>>;
      cloudTasks?: Array<Record<string, unknown>>;
      requestLogs?: RequestLog[];
      officialDownlinkCaptures?: OfficialDownlinkCapture[];
    };
    try {
      const raw = readFileSync(this.filePath, 'utf8').trim();
      if (!raw) {
        return false;
      }
      data = JSON.parse(raw);
    } catch {
      return false;
    }

    data.stores?.forEach((item) => this.stores.set(item.code, item));
    data.baseStations?.forEach((item) => this.baseStations.set(item.id, item));
    data.labels?.forEach((item) => this.labels.set(item.id, item));
    data.commands?.forEach((item) => this.commands.set(item.id, item));
    data.cloudProducts?.forEach((item) => this.cloudProducts.set(String(item.id), item));
    data.cloudTemplates?.forEach((item) => this.cloudTemplates.set(String(item.id), item));
    data.cloudTasks?.forEach((item) => this.cloudTasks.set(String(item.id), item));
    this.requestLogs.push(...(data.requestLogs ?? []));
    this.officialDownlinkCaptures.push(...(data.officialDownlinkCaptures ?? []));
    return true;
  }
}
