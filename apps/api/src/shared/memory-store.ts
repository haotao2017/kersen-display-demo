import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import * as bcrypt from 'bcryptjs';
import { BaseStation, EslCommand, Label, OfficialDownlinkCapture, RequestLog, StoreConfig } from './models';
import { PersistentStoreService } from './persistent-store.service';

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeRole(value: unknown, fallback = 'VIEWER') {
  const role = stringValue(value, fallback).toUpperCase();
  return role === 'ADMIN' || role === 'OPERATOR' || role === 'VIEWER' ? role : fallback;
}

function migrateLegacyOwners(data: {
  stores?: StoreConfig[];
  baseStations?: BaseStation[];
  labels?: Label[];
  cloudProducts?: Row[];
  cloudTemplates?: Row[];
  cloudTasks?: Row[];
  users?: Row[];
}) {
  const stores = data.stores ?? [];
  const baseStations = data.baseStations ?? [];
  const labels = data.labels ?? [];
  const products = data.cloudProducts ?? [];
  const templates = data.cloudTemplates ?? [];
  const tasks = data.cloudTasks ?? [];
  const users = data.users ?? [];
  const admin = users.find((user) => normalizeRole(user.role) === 'ADMIN' && String(user.username ?? '') === 'admin')
    ?? users.find((user) => normalizeRole(user.role) === 'ADMIN')
    ?? users[0];
  const defaultOwnerId = String(admin?.id ?? '');
  if (!defaultOwnerId) return;

  stores.forEach((store) => {
    const row = store as StoreConfig & Row;
    row.ownerUserId = stringValue(row.ownerUserId, defaultOwnerId);
  });
  baseStations.forEach((ap) => {
    const row = ap as BaseStation & Row;
    row.ownerUserId = stringValue(row.ownerUserId, String((stores.find((store) => store.code === ap.storeCode) as Row | undefined)?.ownerUserId ?? defaultOwnerId));
  });
  labels.forEach((label) => {
    const row = label as Label & Row;
    const ap = label.apId ? baseStations.find((item) => item.id === label.apId) as Row | undefined : undefined;
    row.ownerUserId = stringValue(row.ownerUserId, String(ap?.ownerUserId ?? (stores.find((store) => store.code === label.storeCode) as Row | undefined)?.ownerUserId ?? defaultOwnerId));
  });
  products.forEach((product) => {
    product.ownerUserId = stringValue(product.ownerUserId, String((stores.find((store) => store.code === product.storeCode) as Row | undefined)?.ownerUserId ?? defaultOwnerId));
  });
  templates.forEach((template) => {
    template.ownerUserId = stringValue(template.ownerUserId, String((stores.find((store) => store.code === template.storeCode) as Row | undefined)?.ownerUserId ?? defaultOwnerId));
  });
  tasks.forEach((task) => {
    const label = labels.find((item) => item.id === task.eslDeviceId) as Row | undefined;
    task.ownerUserId = stringValue(task.ownerUserId, String(label?.ownerUserId ?? defaultOwnerId));
  });
}

@Injectable()
export class MemoryStore implements OnModuleInit, OnModuleDestroy {
  private readonly filePath = process.env.STORE_JSON_PATH || join(process.cwd(), 'data', 'store.json');
  private saveTimer?: ReturnType<typeof setTimeout>;
  private jsonSaveTimer?: ReturnType<typeof setTimeout>;
  private jsonSavePromise: Promise<void> = Promise.resolve();
  private savingPersistent = false;
  private pendingPersistentSave = false;
  readonly stores = new Map<string, StoreConfig>();
  readonly baseStations = new Map<string, BaseStation>();
  readonly labels = new Map<string, Label>();
  readonly commands = new Map<string, EslCommand>();
  readonly cloudProducts = new Map<string, Record<string, unknown>>();
  readonly cloudTemplates = new Map<string, Record<string, unknown>>();
  readonly cloudTasks = new Map<string, Record<string, unknown>>();
  readonly users = new Map<string, Record<string, unknown>>();
  readonly userInvites = new Map<string, Record<string, unknown>>();
  readonly auditLogs: Array<Record<string, unknown>> = [];
  readonly requestLogs: RequestLog[] = [];
  readonly officialDownlinkCaptures: OfficialDownlinkCapture[] = [];
  readonly apSessions = new Map<string, { storeCode: string; apId: string; createdAt: string; source: 'local' | 'official' }>();
  readonly latestApSessions = new Map<string, { token: string; storeCode: string; apId: string; createdAt: string; source: 'local' | 'official' }>();

  constructor(private readonly persistentStore: PersistentStoreService) {
    if (this.load()) {
      return;
    }

    const storeCode = process.env.UPSTREAM_STORE_CODE ?? '20248517';
    const passwordHash = bcrypt.hashSync('admin123456', 10);

    this.stores.set(storeCode, {
      id: id('store'),
      code: storeCode,
      name: 'Default ESL Store',
      address: '',
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

    migrateLegacyOwners({
      stores: [...this.stores.values()],
      baseStations: [...this.baseStations.values()],
      labels: [...this.labels.values()],
      cloudProducts: [...this.cloudProducts.values()],
      cloudTemplates: [...this.cloudTemplates.values()],
      cloudTasks: [...this.cloudTasks.values()],
      users: [...this.users.values()],
    });
    this.save();
  }

  async onModuleInit() {
    const snapshot = await this.persistentStore.load();
    if (!snapshot) {
      return;
    }

    if (snapshot.stores.length > 0) {
      this.mergeSnapshot(snapshot);
      this.saveJson();
      this.queuePersistentSave();
      return;
    }

    this.queuePersistentSave();
  }

  async onModuleDestroy() {
    if (this.jsonSaveTimer) {
      clearTimeout(this.jsonSaveTimer);
      this.jsonSaveTimer = undefined;
    }
    this.saveJson();
    await this.jsonSavePromise.catch(() => undefined);
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
    this.saveDeferred();
    return log;
  }

  registerApSession(token: string, storeCode: string, apId: string, source: 'local' | 'official' = 'local') {
    const session = { storeCode, apId, createdAt: now(), source };
    this.apSessions.set(token, session);
    this.latestApSessions.set(apId, { ...session, token });
  }

  save() {
    this.queueJsonSave();
    this.queuePersistentSave();
  }

  saveImmediate() {
    this.saveJson();
    this.queuePersistentSave();
  }

  saveDeferred() {
    this.queueJsonSave(Number(process.env.JSON_SAVE_DEBOUNCE_MS ?? 2000));
    this.queuePersistentSave();
  }

  private saveJson() {
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
          users: [...this.users.values()],
          userInvites: [...this.userInvites.values()],
          auditLogs: this.auditLogs,
          requestLogs: this.requestLogs,
          officialDownlinkCaptures: this.officialDownlinkCaptures,
        },
        null,
        2,
      ),
    );
  }

  private queueJsonSave(delayMs = Number(process.env.JSON_SAVE_DEBOUNCE_MS ?? 750)) {
    if (this.jsonSaveTimer) return;
    this.jsonSaveTimer = setTimeout(() => {
      this.jsonSaveTimer = undefined;
      const snapshot = this.buildJsonSnapshot();
      this.jsonSavePromise = this.jsonSavePromise
        .catch(() => undefined)
        .then(async () => {
          await fs.mkdir(dirname(this.filePath), { recursive: true });
          await fs.writeFile(this.filePath, JSON.stringify(snapshot, null, 2));
        })
        .catch(() => undefined);
    }, Math.max(50, Math.min(30_000, delayMs)));
  }

  private buildJsonSnapshot() {
    return {
      stores: [...this.stores.values()],
      baseStations: [...this.baseStations.values()],
      labels: [...this.labels.values()],
      commands: [...this.commands.values()],
      cloudProducts: [...this.cloudProducts.values()],
      cloudTemplates: [...this.cloudTemplates.values()],
      cloudTasks: [...this.cloudTasks.values()],
      users: [...this.users.values()],
      userInvites: [...this.userInvites.values()],
      auditLogs: this.auditLogs,
      requestLogs: this.requestLogs,
      officialDownlinkCaptures: this.officialDownlinkCaptures,
    };
  }

  private queuePersistentSave() {
    if (!this.persistentStore.enabled) return;
    this.pendingPersistentSave = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.flushPersistentSave();
    }, Math.max(500, Math.min(30_000, Number(process.env.PERSISTENT_SAVE_DEBOUNCE_MS ?? 5000))));
  }

  private async flushPersistentSave() {
    if (!this.pendingPersistentSave || this.savingPersistent) return;

    this.pendingPersistentSave = false;
    this.savingPersistent = true;
    try {
      await this.persistentStore.saveSnapshot({
        stores: [...this.stores.values()],
        baseStations: [...this.baseStations.values()],
        labels: [...this.labels.values()],
        cloudProducts: [...this.cloudProducts.values()],
        cloudTemplates: [...this.cloudTemplates.values()],
        cloudTasks: [...this.cloudTasks.values()],
      });
    } finally {
      this.savingPersistent = false;
      if (this.pendingPersistentSave) {
        this.queuePersistentSave();
      }
    }
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
      users?: Array<Record<string, unknown>>;
      userInvites?: Array<Record<string, unknown>>;
      auditLogs?: Array<Record<string, unknown>>;
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

    migrateLegacyOwners(data);
    data.stores?.forEach((item) => this.stores.set(item.code, item));
    data.baseStations?.forEach((item) => this.baseStations.set(item.id, item));
    data.labels?.forEach((item) => this.labels.set(item.id, item));
    data.commands?.forEach((item) => this.commands.set(item.id, item));
    data.cloudProducts?.forEach((item) => this.cloudProducts.set(String(item.id), item));
    data.cloudTemplates?.forEach((item) => this.cloudTemplates.set(String(item.id), item));
    data.cloudTasks?.forEach((item) => this.cloudTasks.set(String(item.id), item));
    data.users?.forEach((item) => this.users.set(String(item.id), item));
    data.userInvites?.forEach((item) => this.userInvites.set(String(item.id), item));
    this.auditLogs.push(...(data.auditLogs ?? []));
    this.requestLogs.push(...(data.requestLogs ?? []));
    this.officialDownlinkCaptures.push(...(data.officialDownlinkCaptures ?? []));
    return true;
  }

  private replaceFromSnapshot(data: {
    stores?: StoreConfig[];
    baseStations?: BaseStation[];
    labels?: Label[];
    commands?: EslCommand[];
    cloudProducts?: Array<Record<string, unknown>>;
    cloudTemplates?: Array<Record<string, unknown>>;
    cloudTasks?: Array<Record<string, unknown>>;
    users?: Array<Record<string, unknown>>;
    userInvites?: Array<Record<string, unknown>>;
    auditLogs?: Array<Record<string, unknown>>;
    requestLogs?: RequestLog[];
    officialDownlinkCaptures?: OfficialDownlinkCapture[];
  }) {
    migrateLegacyOwners(data);
    this.stores.clear();
    this.baseStations.clear();
    this.labels.clear();
    this.commands.clear();
    this.cloudProducts.clear();
    this.cloudTemplates.clear();
    this.cloudTasks.clear();
    this.users.clear();
    this.userInvites.clear();
    this.auditLogs.splice(0);
    this.requestLogs.splice(0);
    this.officialDownlinkCaptures.splice(0);

    data.stores?.forEach((item) => this.stores.set(item.code, item));
    data.baseStations?.forEach((item) => this.baseStations.set(item.id, item));
    data.labels?.forEach((item) => this.labels.set(item.id, item));
    data.commands?.forEach((item) => this.commands.set(item.id, item));
    data.cloudProducts?.forEach((item) => this.cloudProducts.set(String(item.id), item));
    data.cloudTemplates?.forEach((item) => this.cloudTemplates.set(String(item.id), item));
    data.cloudTasks?.forEach((item) => this.cloudTasks.set(String(item.id), item));
    data.users?.forEach((item) => this.users.set(String(item.id), item));
    data.userInvites?.forEach((item) => this.userInvites.set(String(item.id), item));
    this.auditLogs.push(...(data.auditLogs ?? []));
    this.requestLogs.push(...(data.requestLogs ?? []));
    this.officialDownlinkCaptures.push(...(data.officialDownlinkCaptures ?? []));
  }

  private mergeSnapshot(data: {
    stores?: StoreConfig[];
    baseStations?: BaseStation[];
    labels?: Label[];
    commands?: EslCommand[];
    cloudProducts?: Array<Record<string, unknown>>;
    cloudTemplates?: Array<Record<string, unknown>>;
    cloudTasks?: Array<Record<string, unknown>>;
    users?: Array<Record<string, unknown>>;
    userInvites?: Array<Record<string, unknown>>;
    auditLogs?: Array<Record<string, unknown>>;
    requestLogs?: RequestLog[];
    officialDownlinkCaptures?: OfficialDownlinkCapture[];
  }) {
    migrateLegacyOwners(data);
    data.stores?.forEach((item) => this.stores.set(item.code, newerByUpdatedAt(this.stores.get(item.code), item)));
    data.baseStations?.forEach((item) => this.baseStations.set(item.id, newerByUpdatedAt(this.baseStations.get(item.id), item)));
    data.labels?.forEach((item) => this.labels.set(item.id, newerByUpdatedAt(this.labels.get(item.id), item)));
    data.commands?.forEach((item) => this.commands.set(item.id, newerByUpdatedAt(this.commands.get(item.id), item)));
    data.cloudProducts?.forEach((item) => {
      const key = String(item.id);
      this.cloudProducts.set(key, newerByUpdatedAt(this.cloudProducts.get(key), item));
    });
    data.cloudTemplates?.forEach((item) => {
      const key = String(item.id);
      this.cloudTemplates.set(key, newerByUpdatedAt(this.cloudTemplates.get(key), item));
    });
    data.cloudTasks?.forEach((item) => {
      const key = String(item.id);
      this.cloudTasks.set(key, newerByUpdatedAt(this.cloudTasks.get(key), item));
    });
    data.users?.forEach((item) => {
      const key = String(item.id);
      this.users.set(key, newerByUpdatedAt(this.users.get(key), item));
    });
    data.userInvites?.forEach((item) => {
      const key = String(item.id);
      this.userInvites.set(key, newerByUpdatedAt(this.userInvites.get(key), item));
    });

    const auditIds = new Set(this.auditLogs.map((item) => String(item.id)));
    for (const item of data.auditLogs ?? []) {
      if (!auditIds.has(String(item.id))) {
        this.auditLogs.push(item);
      }
    }
    this.auditLogs.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    this.auditLogs.splice(1000);

    const logIds = new Set(this.requestLogs.map((item) => item.id));
    for (const item of data.requestLogs ?? []) {
      if (!logIds.has(item.id)) {
        this.requestLogs.push(item);
      }
    }
    this.requestLogs.sort((a, b) => String(b.time ?? '').localeCompare(String(a.time ?? '')));
    this.requestLogs.splice(1000);

    const captureIds = new Set(this.officialDownlinkCaptures.map((item) => item.id));
    for (const item of data.officialDownlinkCaptures ?? []) {
      if (!captureIds.has(item.id)) {
        this.officialDownlinkCaptures.push(item);
      }
    }
  }
}

function newerByUpdatedAt<T>(current: T | undefined, incoming: T): T {
  if (!current) return incoming;
  const currentRow = current as Record<string, unknown>;
  const incomingRow = incoming as Record<string, unknown>;
  const currentTime = Date.parse(String(currentRow.updatedAt ?? currentRow.createdAt ?? ''));
  const incomingTime = Date.parse(String(incomingRow.updatedAt ?? incomingRow.createdAt ?? ''));
  if (!Number.isFinite(currentTime) && !Number.isFinite(incomingTime)) {
    return mergeJsonRichRow(current, incoming);
  }
  if (!Number.isFinite(currentTime)) {
    return mergeJsonRichRow(incoming, current);
  }
  if (!Number.isFinite(incomingTime)) return current;
  return incomingTime >= currentTime
    ? mergeJsonRichRow(incoming, current)
    : mergeJsonRichRow(current, incoming);
}

function mergeJsonRichRow<T>(winner: T, fallback: T) {
  const output = { ...(fallback as Record<string, unknown>), ...(winner as Record<string, unknown>) };
  for (const key of ['config', 'metrics', 'discoveredLabels']) {
    const winnerValue = (winner as Record<string, unknown>)[key];
    const fallbackValue = (fallback as Record<string, unknown>)[key];
    if (isPlainObject(fallbackValue) && isPlainObject(winnerValue)) {
      output[key] = { ...(fallbackValue as Record<string, unknown>), ...(winnerValue as Record<string, unknown>) };
    }
  }
  return output as T;
}

function isPlainObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
