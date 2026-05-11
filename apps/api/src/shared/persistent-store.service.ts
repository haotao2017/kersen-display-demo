import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { BaseStation, Label, StoreConfig } from './models';

type JsonRow = Record<string, unknown>;

@Injectable()
export class PersistentStoreService implements OnModuleDestroy {
  private readonly logger = new Logger(PersistentStoreService.name);
  private readonly prisma?: PrismaClient;
  private readonly configured = Boolean(process.env.DATABASE_URL);
  private ready = false;
  private disabled = false;

  constructor() {
    if (!this.configured) {
      this.disabled = true;
      this.logger.log('DATABASE_URL not set; using local JSON persistence only.');
      return;
    }

    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    this.prisma = new PrismaClient({
      adapter,
      transactionOptions: {
        maxWait: Math.max(5000, Number(process.env.PRISMA_TRANSACTION_MAX_WAIT_MS ?? 15000)),
        timeout: Math.max(5000, Number(process.env.PRISMA_TRANSACTION_TIMEOUT_MS ?? 60000)),
      },
      log: process.env.PRISMA_QUERY_LOG === 'true' ? ['warn', 'error', 'query'] : ['warn', 'error'],
    });
  }

  get enabled() {
    return Boolean(this.prisma && !this.disabled);
  }

  async health() {
    if (!this.configured) {
      return { ok: true, mode: 'json' };
    }
    if (!this.prisma || this.disabled) {
      return { ok: false, mode: 'postgres', error: 'Postgres persistence is configured but disabled.' };
    }

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, mode: 'postgres' };
    } catch (error) {
      return {
        ok: false,
        mode: 'postgres',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async load() {
    if (!this.prisma || this.disabled) return null;

    try {
      await this.prisma.$connect();
      this.ready = true;
      const [stores, baseStations, labels, products, templates, tasks] = await Promise.all([
        this.prisma.store.findMany(),
        this.prisma.baseStation.findMany(),
        this.prisma.label.findMany(),
        this.prisma.product.findMany(),
        this.prisma.template.findMany(),
        this.prisma.refreshTask.findMany(),
      ]);

      return {
        stores: stores.map((item) => ({
          id: item.id,
          code: item.code,
          name: item.name,
          address: item.address ?? '',
          username: item.username,
          passwordHash: item.passwordHash,
          serverUrl: item.serverUrl ?? '',
          mqttTcpPort: item.mqttTcpPort ?? 1883,
          mqttWsPath: item.mqttWsPath ?? '/mqtt',
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        baseStations: baseStations.map((item) => ({
          id: item.id,
          storeCode: item.storeCode,
          name: item.name,
          mac: item.mac ?? undefined,
          ip: item.ip ?? undefined,
          firmware: item.firmware ?? undefined,
          os: item.os ?? undefined,
          hostAddr: item.hostAddr ?? undefined,
          status: item.status as BaseStation['status'],
          lastSeenAt: item.lastSeenAt?.toISOString(),
          location: item.location ?? undefined,
          config: toJsonObject(item.config),
          channels: Array.isArray(item.channels) ? item.channels as JsonRow[] : undefined,
          metrics: toJsonObject(item.metrics),
          discoveredLabels: toJsonObject(item.discoveredLabels) as BaseStation['discoveredLabels'],
        })),
        labels: labels.map((item) => ({
          id: item.id,
          storeCode: item.storeCode,
          apId: item.apId ?? undefined,
          sku: item.sku ?? undefined,
          title: item.title,
          price: Number(item.price ?? 0),
          currency: item.currency,
          status: item.status as Label['status'],
          battery: item.battery ?? undefined,
          rssi: item.rssi ?? undefined,
          services: toJsonObject(item.services),
          productId: item.productId ?? undefined,
          templateId: item.templateId ?? undefined,
          deviceType: item.deviceType ?? undefined,
          screenWidth: item.screenWidth ?? undefined,
          screenHeight: item.screenHeight ?? undefined,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        cloudProducts: products.map((item) => ({
          id: item.id,
          storeCode: item.storeCode,
          sku: item.sku,
          barcode: item.barcode ?? undefined,
          name: item.name,
          price: Number(item.price ?? 0),
          originalPrice: item.originalPrice == null ? undefined : Number(item.originalPrice),
          memberPrice: item.memberPrice == null ? undefined : Number(item.memberPrice),
          promotionPrice: item.promotionPrice == null ? undefined : Number(item.promotionPrice),
          promotionText: item.promotionText ?? undefined,
          imageUrl: item.imageUrl ?? undefined,
          customFields: toJsonObject(item.customFields),
          defaultTemplateId: item.defaultTemplateId ?? undefined,
          status: item.status,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        cloudTemplates: templates.map((item) => ({
          id: item.id,
          storeCode: item.storeCode,
          code: item.code,
          name: item.name,
          deviceType: item.deviceType,
          width: item.width,
          height: item.height,
          dpi: item.dpi ?? undefined,
          colorMode: item.colorMode,
          status: item.status,
          version: item.version,
          previewImageUrl: item.previewImageUrl ?? undefined,
          schema: toJsonObject(item.schema),
          recentVersions: Array.isArray(item.recentVersions) ? item.recentVersions : [],
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        cloudTasks: tasks.map((item) => ({
          id: item.id,
          storeCode: item.storeCode,
          taskType: item.taskType,
          eslDeviceId: item.eslDeviceId,
          apId: item.apId ?? undefined,
          productId: item.productId ?? undefined,
          templateId: item.templateId ?? undefined,
          payload: toJsonObject(item.payload),
          renderResult: toJsonObject(item.renderResult),
          delivery: item.delivery == null ? undefined : toJsonObject(item.delivery),
          events: Array.isArray(item.events) ? item.events : [],
          retryCount: item.retryCount,
          status: item.status,
          parentTaskId: item.parentTaskId ?? undefined,
          childTaskId: item.childTaskId ?? undefined,
          resultMsg: item.resultMsg ?? undefined,
          triggeredAt: item.triggeredAt.toISOString(),
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
      };
    } catch (error) {
      this.disabled = true;
      this.logger.warn(`Postgres persistence disabled: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async saveSnapshot(snapshot: {
    stores: StoreConfig[];
    baseStations: BaseStation[];
    labels: Label[];
    cloudProducts: JsonRow[];
    cloudTemplates: JsonRow[];
    cloudTasks: JsonRow[];
  }) {
    if (!this.prisma || !this.ready || this.disabled) return;

    try {
      await this.prisma.$transaction(async (tx) => {
        const storeCodes = snapshot.stores.map((item) => item.code);
        const storeCodeSet = new Set(storeCodes);
        const fallbackStoreCode = storeCodes[0] ?? process.env.UPSTREAM_STORE_CODE ?? '20248517';
        const apIds = snapshot.baseStations.map((item) => item.id);
        const apIdSet = new Set(apIds);
        const labelIds = snapshot.labels.map((item) => item.id);
        const productIds = snapshot.cloudProducts.map((item) => stringValue(item.id)).filter(Boolean);
        const productIdSet = new Set(productIds);
        const templateIds = snapshot.cloudTemplates.map((item) => stringValue(item.id)).filter(Boolean);
        const templateIdSet = new Set(templateIds);
        const taskIds = snapshot.cloudTasks.map((item) => stringValue(item.id)).filter(Boolean);

        for (const store of snapshot.stores) {
          await tx.store.upsert({
            where: { code: store.code },
            update: {
              id: store.id,
              name: store.name,
              address: store.address ?? '',
              username: store.username,
              passwordHash: store.passwordHash,
              serverUrl: store.serverUrl,
              mqttTcpPort: store.mqttTcpPort,
              mqttWsPath: store.mqttWsPath,
              updatedAt: toDate(store.updatedAt),
            },
            create: {
              id: store.id,
              code: store.code,
              name: store.name,
              address: store.address ?? '',
              username: store.username,
              passwordHash: store.passwordHash,
              serverUrl: store.serverUrl,
              mqttTcpPort: store.mqttTcpPort,
              mqttWsPath: store.mqttWsPath,
              createdAt: toDate(store.createdAt),
              updatedAt: toDate(store.updatedAt),
            },
          });
        }

        for (const ap of snapshot.baseStations) {
          const safeStoreCode = safeStoreCodeOf(ap.storeCode, storeCodeSet, fallbackStoreCode);
          await tx.baseStation.upsert({
            where: { id: ap.id },
            update: {
              storeCode: safeStoreCode,
              name: ap.name,
              mac: ap.mac,
              ip: ap.ip,
              firmware: ap.firmware,
              os: ap.os,
              hostAddr: ap.hostAddr,
              status: ap.status,
              lastSeenAt: ap.lastSeenAt ? toDate(ap.lastSeenAt) : null,
              location: toJson(ap.location),
              config: toJson(ap.config ?? {}),
              channels: toJson(ap.channels),
              metrics: toJson(ap.metrics ?? {}),
              discoveredLabels: toJson(ap.discoveredLabels ?? {}),
            },
            create: {
              id: ap.id,
              storeCode: safeStoreCode,
              name: ap.name,
              mac: ap.mac,
              ip: ap.ip,
              firmware: ap.firmware,
              os: ap.os,
              hostAddr: ap.hostAddr,
              status: ap.status,
              lastSeenAt: ap.lastSeenAt ? toDate(ap.lastSeenAt) : null,
              location: toJson(ap.location),
              config: toJson(ap.config ?? {}),
              channels: toJson(ap.channels),
              metrics: toJson(ap.metrics ?? {}),
              discoveredLabels: toJson(ap.discoveredLabels ?? {}),
            },
          });
        }

        for (const template of snapshot.cloudTemplates) {
          await tx.template.upsert({
            where: { id: stringValue(template.id) },
            update: templateInput(template),
            create: templateInput(template),
          });
        }

        for (const product of snapshot.cloudProducts) {
          await tx.product.upsert({
            where: { id: stringValue(product.id) },
            update: productInput(product, templateIdSet),
            create: productInput(product, templateIdSet),
          });
        }

        for (const label of snapshot.labels) {
          const row = label as Label & JsonRow;
          await tx.label.upsert({
            where: { id: label.id },
            update: labelInput(row, apIdSet, storeCodeSet, fallbackStoreCode, productIdSet, templateIdSet),
            create: labelInput(row, apIdSet, storeCodeSet, fallbackStoreCode, productIdSet, templateIdSet),
          });
        }

        for (const task of snapshot.cloudTasks) {
          await tx.refreshTask.upsert({
            where: { id: stringValue(task.id) },
            update: refreshTaskInput(task, apIdSet, storeCodeSet, fallbackStoreCode, productIdSet, templateIdSet),
            create: refreshTaskInput(task, apIdSet, storeCodeSet, fallbackStoreCode, productIdSet, templateIdSet),
          });
        }

        if (storeCodes.length) {
          await tx.refreshTask.deleteMany({ where: { ...missingIdWhere(taskIds), storeCode: { in: storeCodes } } });
          await tx.label.deleteMany({ where: { ...missingIdWhere(labelIds), storeCode: { in: storeCodes } } });
          await tx.product.deleteMany({ where: { ...missingIdWhere(productIds), storeCode: { in: storeCodes } } });
          await tx.template.deleteMany({ where: { ...missingIdWhere(templateIds), storeCode: { in: storeCodes } } });
          await tx.baseStation.deleteMany({ where: { ...missingIdWhere(apIds), storeCode: { in: storeCodes } } });
        }
      });
    } catch (error) {
      this.logger.warn(`Failed to sync snapshot to Postgres: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async onModuleDestroy() {
    await this.prisma?.$disconnect();
  }
}

function toDate(value: unknown) {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function toJson(value: unknown) {
  return value == null ? undefined : JSON.parse(JSON.stringify(value));
}

function toJsonObject(value: unknown): JsonRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRow : {};
}

function stringValue(value: unknown, fallback = '') {
  return value == null || value === '' ? fallback : String(value);
}

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function storeCodeOf(row: JsonRow) {
  return stringValue(row.storeCode, process.env.UPSTREAM_STORE_CODE ?? '20248517');
}

function safeStoreCodeOf(value: unknown, validStoreCodes: Set<string>, fallbackStoreCode: string) {
  const storeCode = stringValue(value);
  return storeCode && validStoreCodes.has(storeCode) ? storeCode : fallbackStoreCode;
}

function productInput(row: JsonRow, validTemplateIds?: Set<string>) {
  const timestamp = toDate(row.updatedAt ?? row.createdAt);
  return {
    id: stringValue(row.id),
    storeCode: storeCodeOf(row),
    sku: stringValue(row.sku, stringValue(row.barcode, 'SKU')),
    barcode: row.barcode == null ? null : String(row.barcode),
    name: stringValue(row.name, 'Unnamed Product'),
    price: numberValue(row.price, 0),
    originalPrice: row.originalPrice == null ? null : numberValue(row.originalPrice),
    memberPrice: row.memberPrice == null ? null : numberValue(row.memberPrice),
    promotionPrice: row.promotionPrice == null ? null : numberValue(row.promotionPrice),
    promotionText: row.promotionText == null ? null : String(row.promotionText),
    imageUrl: row.imageUrl == null ? null : String(row.imageUrl),
    customFields: toJson(row.customFields ?? {}),
    defaultTemplateId: relationId(row.defaultTemplateId, validTemplateIds),
    status: stringValue(row.status, 'active'),
    createdAt: toDate(row.createdAt ?? timestamp),
    updatedAt: timestamp,
  };
}

function templateInput(row: JsonRow) {
  const timestamp = toDate(row.updatedAt ?? row.createdAt);
  return {
    id: stringValue(row.id),
    storeCode: storeCodeOf(row),
    code: stringValue(row.code, stringValue(row.id, `TPL_${Date.now()}`)),
    name: stringValue(row.name, 'Default Template'),
    deviceType: stringValue(row.deviceType, 'ET0750-89'),
    width: numberValue(row.width, 800),
    height: numberValue(row.height, 480),
    dpi: row.dpi == null ? null : numberValue(row.dpi, 120),
    colorMode: stringValue(row.colorMode, 'bwry'),
    status: stringValue(row.status, 'draft'),
    version: numberValue(row.version, 1),
    previewImageUrl: row.previewImageUrl == null ? null : String(row.previewImageUrl),
    schema: toJson(row.schema ?? {}),
    recentVersions: toJson(row.recentVersions ?? []),
    createdAt: toDate(row.createdAt ?? timestamp),
    updatedAt: timestamp,
  };
}

function relationId(value: unknown, validIds?: Set<string>) {
  const id = value == null || value === '' ? '' : String(value);
  if (!id) {
    return null;
  }
  return validIds && !validIds.has(id) ? null : id;
}

function labelInput(
  row: Label & JsonRow,
  validApIds?: Set<string>,
  validStoreCodes?: Set<string>,
  fallbackStoreCode?: string,
  validProductIds?: Set<string>,
  validTemplateIds?: Set<string>,
) {
  const timestamp = toDate(row.updatedAt ?? row.createdAt);
  return {
    id: row.id,
    storeCode: validStoreCodes && fallbackStoreCode ? safeStoreCodeOf(row.storeCode, validStoreCodes, fallbackStoreCode) : row.storeCode,
    apId: relationId(row.apId, validApIds),
    sku: row.sku ?? null,
    title: row.title,
    price: numberValue(row.price, 0),
    currency: row.currency,
    status: row.status,
    battery: row.battery ?? null,
    rssi: row.rssi ?? null,
    services: toJson(row.services),
    productId: relationId(row.productId, validProductIds),
    templateId: relationId(row.templateId, validTemplateIds),
    deviceType: row.deviceType == null ? null : String(row.deviceType),
    screenWidth: row.screenWidth == null ? null : numberValue(row.screenWidth),
    screenHeight: row.screenHeight == null ? null : numberValue(row.screenHeight),
    createdAt: toDate(row.createdAt ?? timestamp),
    updatedAt: timestamp,
  };
}

function refreshTaskInput(
  row: JsonRow,
  validApIds?: Set<string>,
  validStoreCodes?: Set<string>,
  fallbackStoreCode?: string,
  validProductIds?: Set<string>,
  validTemplateIds?: Set<string>,
) {
  const timestamp = toDate(row.updatedAt ?? row.createdAt);
  return {
    id: stringValue(row.id),
    storeCode: validStoreCodes && fallbackStoreCode ? safeStoreCodeOf(row.storeCode, validStoreCodes, fallbackStoreCode) : storeCodeOf(row),
    taskType: stringValue(row.taskType, 'refresh'),
    eslDeviceId: stringValue(row.eslDeviceId),
    apId: relationId(row.apId, validApIds),
    productId: relationId(row.productId, validProductIds),
    templateId: relationId(row.templateId, validTemplateIds),
    payload: toJson(row.payload ?? {}),
    renderResult: toJson(row.renderResult ?? {}),
    delivery: toJson(row.delivery),
    events: toJson(row.events ?? []),
    retryCount: numberValue(row.retryCount),
    status: stringValue(row.status, 'queued'),
    parentTaskId: row.parentTaskId == null || row.parentTaskId === '' ? null : String(row.parentTaskId),
    childTaskId: row.childTaskId == null || row.childTaskId === '' ? null : String(row.childTaskId),
    resultMsg: row.resultMsg == null ? null : String(row.resultMsg),
    triggeredAt: toDate(row.triggeredAt ?? timestamp),
    createdAt: toDate(row.createdAt ?? timestamp),
    updatedAt: timestamp,
  };
}

function missingIdWhere(ids: string[]) {
  return ids.length ? { id: { notIn: ids } } : {};
}
