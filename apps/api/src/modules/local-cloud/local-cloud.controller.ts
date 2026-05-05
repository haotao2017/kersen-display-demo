import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { Response } from 'express';
import sharp = require('sharp');
import { MemoryStore } from '../../shared/memory-store';
import { BaseStation, Label } from '../../shared/models';
import { ApWebsocketService } from '../ap-websocket/ap-websocket.service';
import { LabelRendererService } from '../labels/label-renderer.service';
import { MqttService } from '../mqtt/mqtt.service';

type Row = Record<string, unknown>;
type LocalDevice = Row & {
  id: string;
  eslCode: string;
  apId?: string;
  productId?: unknown;
  templateId?: unknown;
  bindStatus: string;
  status: string;
  battery: number;
  signal: number;
  updatedAt: string;
};
type LocalAp = Row & {
  id: string;
  apCode: string;
  name: string;
  online: boolean;
  updatedAt: string;
};
type RenderedTemplateImage = {
  width: number;
  height: number;
  colorMode: string;
  svg: string;
  rgba: Buffer;
  previewImageUrl: string;
  bindings: Record<string, string>;
  template: Row;
};
type LocalImagePacket = {
  topic: string;
  publishTopics: string[];
  command: Row;
  payloadBytes: number;
  imageBytes: number;
  imageFormat: string;
  renderMode: string;
  fit: string;
  resample: string;
  dither: boolean;
  width: number;
  height: number;
};
type ScreenPreset = {
  width: number;
  height: number;
  service: '01-00-00-03' | '01-00-00-0c';
  magic: number;
  bpp: 1 | 2;
  supersize?: boolean;
  mtu?: number;
  rotate: number;
  mirrorX: boolean;
  mode: string;
};

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const uploadDir = join(process.cwd(), 'uploads');
const SVG_FONT_STACK = 'Arial, Microsoft YaHei, sans-serif';
const OFFLINE_AFTER_MS = Number(process.env.AP_OFFLINE_AFTER_SECONDS ?? 90) * 1000;

const SCREEN_PRESETS: ScreenPreset[] = [
  { width: 800, height: 480, service: '01-00-00-0c', magic: 0x0c, bpp: 2, supersize: true, mtu: 10000, rotate: 0, mirrorX: false, mode: '0C 800x480' },
  { width: 648, height: 480, service: '01-00-00-03', magic: 0x0a, bpp: 2, rotate: 0, mirrorX: false, mode: '03-0A 648x480#b0y2r3w1' },
  { width: 400, height: 300, service: '01-00-00-03', magic: 0x04, bpp: 2, rotate: 0, mirrorX: false, mode: '03-04 400x300#b0y2r3w1' },
  { width: 240, height: 416, service: '01-00-00-03', magic: 0x04, bpp: 2, rotate: 90, mirrorX: true, mode: '03-04 240x416#b0y2r3w1' },
  { width: 184, height: 384, service: '01-00-00-03', magic: 0x03, bpp: 2, rotate: 90, mirrorX: false, mode: '03-03 184x384#b0y2r3w1' },
  { width: 152, height: 296, service: '01-00-00-03', magic: 0x02, bpp: 2, rotate: 90, mirrorX: true, mode: '03-02 152x296#b0y2r3w1' },
  { width: 128, height: 296, service: '01-00-00-03', magic: 0x02, bpp: 2, rotate: 90, mirrorX: true, mode: '03-02 128x296#b0y2r3w1' },
  { width: 200, height: 200, service: '01-00-00-03', magic: 0x02, bpp: 2, rotate: 90, mirrorX: false, mode: '03-02 200x200#b0y2r3w1' },
  { width: 128, height: 250, service: '01-00-00-03', magic: 0x01, bpp: 2, rotate: 90, mirrorX: false, mode: '03-01 128x250#b0y2r3w1' },
];

function paginate<T>(items: T[], query?: Row) {
  const page = Number(query?.page ?? 1);
  const pageSize = Number(query?.pageSize ?? 100);
  return {
    items,
    page,
    pageSize,
    total: items.length,
  };
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isRecentActivity(value?: string) {
  if (!value) {
    return false;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) && Date.now() - time <= OFFLINE_AFTER_MS;
}

function imageContentType(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

function imageExtension(mimeType?: string, originalname?: string) {
  const fromName = extname(originalname ?? '').toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(fromName)) return fromName;
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  return '.bin';
}

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function defaultSchema(template: Row) {
  const width = numberValue(template.width, 800);
  const height = numberValue(template.height, 480);
  const name = stringValue(template.name, 'Default Template');
  return {
    meta: {
      name,
      deviceType: stringValue(template.deviceType, 'ET0750-89'),
      width,
      height,
      colorMode: stringValue(template.colorMode, 'bwry'),
      version: numberValue(template.version, 1),
    },
    datasource: ['name', 'price', 'sku', 'barcode', 'imageUrl'],
    elements: [
      {
        id: 'background',
        type: 'image',
        x: 0,
        y: 0,
        width,
        height,
        rotate: 0,
        visible: true,
        zIndex: 1,
        bindingField: null,
        expression: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=80',
        style: {
          fontSize: 14,
          fontWeight: 'normal',
          textAlign: 'left',
          fill: '#111111',
          stroke: '#d0d0d0',
          background: '#ffffff',
        },
      },
    ],
  };
}

function resizeSchemaToCanvas(schema: Row, width: number, height: number, deviceType: string, colorMode: string) {
  const meta = (schema.meta && typeof schema.meta === 'object' ? schema.meta : {}) as Row;
  const oldWidth = numberValue(meta.width, width);
  const oldHeight = numberValue(meta.height, height);
  const scaleX = oldWidth ? width / oldWidth : 1;
  const scaleY = oldHeight ? height / oldHeight : 1;
  const elements = Array.isArray(schema.elements) ? schema.elements as Row[] : [];
  return {
    ...schema,
    meta: {
      ...meta,
      deviceType,
      width,
      height,
      colorMode,
    },
    elements: elements.map((element) => {
      const isBackground = element.type === 'image'
        && numberValue(element.x) === 0
        && numberValue(element.y) === 0
        && numberValue(element.width) === oldWidth
        && numberValue(element.height) === oldHeight
        && numberValue(element.zIndex) <= 1;
      if (isBackground) {
        return { ...element, x: 0, y: 0, width, height, zIndex: 1 };
      }
      return {
        ...element,
        x: Math.round(numberValue(element.x) * scaleX),
        y: Math.round(numberValue(element.y) * scaleY),
        width: Math.max(1, Math.round(numberValue(element.width, 1) * scaleX)),
        height: Math.max(1, Math.round(numberValue(element.height, 1) * scaleY)),
      };
    }),
  };
}

@Controller('api/v1')
export class LocalCloudController {
  constructor(
    private readonly db: MemoryStore,
    private readonly jwt: JwtService,
    private readonly renderer: LabelRendererService,
    private readonly mqtt: MqttService,
    private readonly apWebsocket: ApWebsocketService,
  ) {}

  @Post('auth/login')
  login(@Body() body: Row) {
    const storeCode = stringValue(body.storeCode, process.env.UPSTREAM_STORE_CODE ?? '20248517');
    const username = stringValue(body.username, 'admin');
    const store = this.db.stores.get(storeCode) ?? [...this.db.stores.values()][0];
    if (!store || store.username !== username || !bcrypt.compareSync(String(body.password ?? ''), store.passwordHash)) {
      throw new NotFoundException('Invalid username or password');
    }
    const user = {
      id: store.id,
      username: store.username,
      displayName: store.name,
      role: 'ADMIN' as const,
      status: 'active' as const,
      createdAt: store.createdAt,
    };
    return {
      accessToken: this.jwt.sign({ sub: store.id, storeCode: store.code, username: store.username }),
      refreshToken: this.jwt.sign({ sub: store.id, type: 'refresh' }, { expiresIn: '30d' }),
      expiresIn: 28800,
      user,
    };
  }

  @Post('auth/refresh')
  refresh() {
    const store = [...this.db.stores.values()][0];
    return {
      accessToken: this.jwt.sign({ sub: store?.id ?? 'local', storeCode: store?.code, username: store?.username }),
      refreshToken: this.jwt.sign({ sub: store?.id ?? 'local', type: 'refresh' }, { expiresIn: '30d' }),
      expiresIn: 28800,
    };
  }

  @Post('auth/logout')
  logout() {
    return true;
  }

  @Get('auth/me')
  me() {
    const store = [...this.db.stores.values()][0];
    return {
      id: store?.id ?? 'local-admin',
      username: store?.username ?? 'admin',
      displayName: store?.name ?? 'Local ESL Cloud',
      role: 'ADMIN',
      status: 'active',
      createdAt: store?.createdAt ?? now(),
    };
  }

  @Get('dashboard/summary')
  dashboard() {
    const aps = this.localAps();
    const devices = this.localDevices();
    const today = new Date().toISOString().slice(0, 10);
    const tasks = [...this.db.cloudTasks.values()];
    return {
      apOnlineCount: aps.filter((item) => item.online).length,
      apOfflineCount: aps.filter((item) => !item.online).length,
      deviceOnlineCount: devices.filter((item) => item.status === 'online').length,
      todayTaskSuccess: tasks.filter((item) => String(item.status) === 'success' && String(item.updatedAt ?? '').startsWith(today)).length,
      recentApEvents: aps.slice(0, 5).map((ap) => ({
        type: 'ap',
        timestamp: String(ap.lastHeartbeatAt ?? ap.updatedAt),
        title: `${ap.name}`,
        message: ap.online ? '基站在线' : '基站离线',
      })),
      recentFailedTasks: tasks.filter((item) => String(item.status) === 'failed').slice(0, 5).map((task) => ({
        id: String(task.id),
        timestamp: String(task.updatedAt ?? task.createdAt ?? now()),
        title: String(task.taskType ?? 'refresh'),
        message: String(task.resultMsg ?? '任务失败'),
        related: String(task.eslDeviceId ?? ''),
      })),
    };
  }

  @Get('products')
  products(@Query() query: Row) {
    return paginate(this.localProducts(), query);
  }

  @Post('products')
  createProduct(@Body() body: Row) {
    const product = this.upsertProduct({ ...body, id: id('product') });
    return product;
  }

  @Get('products/:productId')
  product(@Param('productId') productId: string) {
    const product = this.findProduct(productId);
    return {
      ...product,
      defaultTemplate: product.defaultTemplateId ? this.db.cloudTemplates.get(String(product.defaultTemplateId)) ?? null : null,
      boundDevices: this.localDevices().filter((item) => item.productId === productId),
    };
  }

  @Put('products/:productId')
  updateProduct(@Param('productId') productId: string, @Body() body: Row) {
    const current = this.findProduct(productId);
    const product = this.upsertProduct({ ...current, ...body, id: productId });
    return {
      ...product,
      refresh: {
        attempted: false,
        boundDeviceCount: this.localDevices().filter((item) => item.productId === productId).length,
        refreshableDeviceCount: 0,
        skippedDeviceCount: 0,
        createdTaskCount: 0,
        taskIds: [],
        reasonCode: null,
        message: '商品已更新，未自动下发',
      },
    };
  }

  @Post('products/:productId/refresh-linked-devices')
  async refreshProduct(@Param('productId') productId: string) {
    const tasks = await Promise.all(this.localDevices()
      .filter((item) => item.productId === productId)
      .map((device) => this.createRefreshTask(String(device.id), 'product_refresh')));
    const taskIds = tasks.map((task) => String(task.id));
    return { createdTaskCount: taskIds.length, taskIds, boundDeviceCount: taskIds.length, skippedDeviceCount: 0, reasonCode: taskIds.length ? null : 'no_bound_devices' };
  }

  @Get('templates')
  templates(@Query() query: Row) {
    this.ensureDefaultTemplate();
    return paginate([...this.db.cloudTemplates.values()].map((item) => this.ensureTemplatePreview(item)), query);
  }

  @Post('templates')
  createTemplate(@Body() body: Row) {
    const template = this.upsertTemplate({ ...body, id: id('template') });
    return template;
  }

  @Get('templates/:templateId')
  template(@Param('templateId') templateId: string) {
    return this.findTemplate(templateId);
  }

  @Put('templates/:templateId')
  updateTemplate(@Param('templateId') templateId: string, @Body() body: Row) {
    const current = this.findTemplate(templateId);
    return this.upsertTemplate({ ...current, ...body, id: templateId });
  }

  @Get('templates/:templateId/schema')
  templateSchema(@Param('templateId') templateId: string) {
    return { schema: this.findTemplate(templateId).schema };
  }

  @Put('templates/:templateId/schema')
  saveTemplateSchema(@Param('templateId') templateId: string, @Body() body: Row) {
    const current = this.findTemplate(templateId);
    const schema = body.schema ?? current.schema;
    const template = this.upsertTemplate({
      ...current,
      schema,
      status: 'draft',
      previewImageUrl: this.templatePreviewUrl(templateId),
    });
    return { schema: template.schema };
  }

  @Get('templates/:templateId/preview-image')
  async templatePreviewImage(@Param('templateId') templateId: string, @Res({ passthrough: true }) response: Response) {
    const template = this.findTemplate(templateId);
    const render = await this.renderTemplateForLabel(this.labelFromProduct({
      id: 'preview',
      sku: 'PREVIEW',
      name: stringValue(template.name, 'Preview Product'),
      price: 19.9,
    }), template);
    const png = Buffer.from(render.previewImageUrl.split(',')[1] ?? '', 'base64');
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(png);
  }

  @Post('templates/:templateId/preview')
  async previewTemplate(@Param('templateId') templateId: string, @Body() body: Row) {
    const template = this.findTemplate(templateId);
    const sampleData = (body.sampleData && typeof body.sampleData === 'object' ? body.sampleData : {}) as Row;
    const label = this.labelFromProduct({
      id: 'preview',
      sku: stringValue(sampleData.sku, 'PREVIEW'),
      name: stringValue(sampleData.name, stringValue(template.name, 'Preview Product')),
      price: numberValue(sampleData.price, 19.9),
    });
    (label as Label & Row).templateId = templateId;
    const render = await this.renderTemplateForLabel(label, template);
    return {
      previewImageUrl: render.previewImageUrl,
      renderResult: {
        width: render.width,
        height: render.height,
        source: 'local-template-renderer',
        colorMode: render.colorMode,
      },
    };
  }

  @Post('templates/:templateId/publish')
  publishTemplate(@Param('templateId') templateId: string) {
    const current = this.findTemplate(templateId);
    this.upsertTemplate({
      ...current,
      status: 'published',
      version: numberValue(current.version, 1) + 1,
      previewImageUrl: this.templatePreviewUrl(templateId),
    });
    return { ok: true };
  }

  @Post('templates/:templateId/duplicate')
  duplicateTemplate(@Param('templateId') templateId: string, @Body() body: Row) {
    const current = this.findTemplate(templateId);
    return this.upsertTemplate({
      ...current,
      id: id('template'),
      name: stringValue(body.name, `${String(current.name)} Copy`),
      code: stringValue(body.code, `${String(current.code)}_copy`),
      status: 'draft',
    });
  }

  @Delete('templates/:templateId')
  deleteTemplate(@Param('templateId') templateId: string) {
    this.db.cloudTemplates.delete(templateId);
    this.db.save();
    return { deleted: true, id: templateId };
  }

  @Delete('templates/:templateId/versions/:versionId')
  deleteTemplateVersion(@Param('versionId') versionId: string) {
    return { deleted: true, versionId };
  }

  @Get('esl-devices')
  devices(@Query() query: Row) {
    return paginate(this.localDevices(), query);
  }

  @Post('esl-devices')
  createDevice(@Body() body: Row) {
    const storeCode = [...this.db.stores.values()][0]?.code ?? 'local';
    const label: Label & Row = {
      id: stringValue(body.eslCode, id('label')),
      storeCode,
      apId: stringValue(body.apId) || undefined,
      sku: stringValue(body.eslCode),
      title: stringValue(body.name, stringValue(body.eslCode, 'Display Node')),
      price: 0,
      currency: 'CNY',
      status: 'idle',
      battery: 100,
      updatedAt: now(),
      deviceType: stringValue(body.deviceType, 'KERSEN_296_128'),
    };
    this.db.labels.set(label.id, label);
    this.db.save();
    return this.localDevice(label);
  }

  @Get('esl-devices/:deviceId')
  device(@Param('deviceId') deviceId: string) {
    const label = this.findLabel(deviceId);
    return {
      ...this.localDevice(label),
      recentTasks: [...this.db.cloudTasks.values()].filter((item) => item.eslDeviceId === deviceId),
    };
  }

  @Put('esl-devices/:deviceId')
  updateDevice(@Param('deviceId') deviceId: string, @Body() body: Row) {
    const label = this.findLabel(deviceId) as Label & Row;
    label.id = stringValue(body.eslCode, label.id);
    label.title = stringValue(body.name, label.title);
    label.apId = stringValue(body.apId) || undefined;
    label.productId = stringValue(body.productId) || undefined;
    label.templateId = stringValue(body.templateId) || undefined;
    label.updatedAt = now();
    if (label.id !== deviceId) {
      this.db.labels.delete(deviceId);
    }
    this.db.labels.set(label.id, label);
    this.db.save();
    return this.localDevice(label);
  }

  @Post('esl-devices/:deviceId/bind')
  async bindDevice(@Param('deviceId') deviceId: string, @Body() body: Row) {
    const label = this.findLabel(deviceId) as Label & Row;
    const product = this.findProduct(String(body.productId));
    label.productId = product.id;
    label.templateId = stringValue(body.templateId, stringValue(product.defaultTemplateId));
    label.sku = stringValue(product.sku, label.sku);
    label.title = stringValue(product.name, label.title);
    label.price = numberValue(product.price, label.price);
    label.updatedAt = now();
    this.db.labels.set(label.id, label);
    this.db.save();
    const task = body.autoRefresh === false ? null : await this.createRefreshTask(label.id, 'bind_refresh');
    return { ...this.localDevice(label), recentTasks: task ? [task] : [] };
  }

  @Post('esl-devices/:deviceId/unbind')
  unbindDevice(@Param('deviceId') deviceId: string) {
    const label = this.findLabel(deviceId) as Label & Row;
    delete label.productId;
    delete label.templateId;
    label.updatedAt = now();
    this.db.save();
    return this.localDevice(label);
  }

  @Post('esl-devices/:deviceId/refresh')
  async refreshDevice(@Param('deviceId') deviceId: string) {
    const task = await this.createRefreshTask(deviceId, 'manual_refresh');
    return { ok: true, taskId: task.id };
  }

  @Post('esl-devices/:deviceId/adjust')
  adjustDevice(@Param('deviceId') deviceId: string) {
    this.findLabel(deviceId);
    return { ok: true };
  }

  @Get('esl-devices/:deviceId/tasks')
  deviceTasks(@Param('deviceId') deviceId: string) {
    return [...this.db.cloudTasks.values()].filter((item) => item.eslDeviceId === deviceId);
  }

  @Get('aps')
  aps(@Query() query: Row) {
    return paginate(this.localAps(), query);
  }

  @Post('aps')
  createAp(@Body() body: Row) {
    const storeCode = [...this.db.stores.values()][0]?.code ?? 'local';
    const apCode = stringValue(body.apCode, id('ap'));
    const ap: BaseStation & Row = {
      id: apCode,
      storeCode,
      name: stringValue(body.name, apCode),
      ip: stringValue(body.ip) || undefined,
      mac: stringValue(body.mac) || undefined,
      firmware: stringValue(body.firmwareVersion) || undefined,
      status: 'offline',
      metrics: {},
      location: body.location,
      config: body.config ?? {},
    };
    this.db.baseStations.set(ap.id, ap);
    this.db.save();
    return this.localAp(ap);
  }

  @Get('aps/:apId')
  ap(@Param('apId') apId: string) {
    return this.localAp(this.findAp(apId));
  }

  @Put('aps/:apId')
  updateAp(@Param('apId') apId: string, @Body() body: Row) {
    const ap = this.findAp(apId) as BaseStation & Row;
    ap.name = stringValue(body.name, ap.name);
    ap.ip = stringValue(body.ip) || ap.ip;
    ap.mac = stringValue(body.mac) || ap.mac;
    ap.firmware = stringValue(body.firmwareVersion) || ap.firmware;
    ap.location = body.location ?? ap.location;
    ap.config = body.config ?? ap.config ?? {};
    this.db.save();
    return this.localAp(ap);
  }

  @Post('aps/:apId/sync-status')
  syncAp(@Param('apId') apId: string) {
    const ap = this.findAp(apId);
    return { ok: true, status: this.localAp(ap)?.status ?? 'offline' };
  }

  @Post('aps/:apId/search-devices')
  searchDevices(@Param('apId') apId: string) {
    this.findAp(apId);
    return { ok: true, devices: this.localDevices().filter((item) => item.apId === apId) };
  }

  @Post('aps/:apId/config')
  configAp(@Param('apId') apId: string, @Body() body: Row) {
    const ap = this.findAp(apId) as BaseStation & Row;
    ap.config = body.config ?? {};
    this.db.save();
    return this.localAp(ap);
  }

  @Post('aps/:apId/unbind-devices')
  unbindApDevices(@Param('apId') apId: string) {
    let count = 0;
    for (const label of this.db.labels.values()) {
      const row = label as Label & Row;
      if (row.apId === apId) {
        delete row.apId;
        count += 1;
      }
    }
    this.db.save();
    return { unboundDeviceCount: count };
  }

  @Post('aps/:apId/transfer-owner')
  transferApOwner(@Param('apId') apId: string) {
    return { ...this.localAp(this.findAp(apId)), transferredDeviceCount: 0, targetUser: this.me() };
  }

  @Delete('aps/:apId')
  deleteAp(@Param('apId') apId: string) {
    this.db.baseStations.delete(apId);
    this.db.save();
    return { ok: true };
  }

  @Get('aps/:apId/heartbeats')
  apHeartbeats(@Param('apId') apId: string) {
    const ap = this.findAp(apId);
    return [{
      id: `${ap.id}-latest`,
      createdAt: ap.lastSeenAt ?? now(),
      status: ap.status,
      payloadJson: { ip: ap.ip, firmware: ap.firmware },
    }];
  }

  @Get('tasks')
  tasks(@Query() query: Row) {
    return paginate([...this.db.cloudTasks.values()].reverse(), query);
  }

  @Get('tasks/:taskId')
  task(@Param('taskId') taskId: string) {
    const task = this.db.cloudTasks.get(taskId);
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  @Post('tasks/:taskId/retry')
  async retryTask(@Param('taskId') taskId: string) {
    const task = this.db.cloudTasks.get(taskId);
    if (!task) throw new NotFoundException('Task not found');
    const retry = await this.createRefreshTask(String(task.eslDeviceId ?? ''), 'retry_refresh', taskId);
    return retry;
  }

  @Post('tasks/batch-refresh')
  async batchRefresh(@Body() body: Row) {
    const ids = Array.isArray(body.deviceIds) ? body.deviceIds.map(String) : this.localDevices().map((item) => String(item.id));
    await Promise.all(ids.map((deviceId) => this.createRefreshTask(deviceId, 'batch_refresh')));
    return { ok: true };
  }

  @Get('users')
  users() {
    return [this.me()];
  }

  @Get('users/invites')
  invites() {
    return [];
  }

  @Get('users/audit-logs')
  auditLogs() {
    return [];
  }

  @Post('users/invites')
  createInvite(@Body() body: Row) {
    return { id: id('invite'), token: id('token'), username: body.username, role: body.role ?? 'VIEWER', expiresAt: now(), createdAt: now() };
  }

  @Post('users/:userId/disable')
  disableUser() {
    return this.me();
  }

  @Post('users/:userId/enable')
  enableUser() {
    return this.me();
  }

  @Post('users/:userId/reset-password')
  resetPassword() {
    return this.me();
  }

  @Post('users/invites/:inviteId/revoke')
  revokeInvite(@Param('inviteId') inviteId: string) {
    return { id: inviteId, revokedAt: now() };
  }

  @Post('uploads/image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @UploadedFile() file?: { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('image file is required');
    }
    if (!(file.mimetype ?? '').startsWith('image/')) {
      throw new BadRequestException('only image uploads are supported');
    }

    await fs.mkdir(uploadDir, { recursive: true });
    const ext = imageExtension(file.mimetype, file.originalname);
    const filename = `${Date.now()}-${randomUUID()}${ext}`;
    await fs.writeFile(join(uploadDir, filename), file.buffer);

    return {
      url: `/api/v1/uploads/files/${filename}`,
      key: `uploads/${filename}`,
      mimeType: file.mimetype,
      size: file.size ?? file.buffer.length,
    };
  }

  @Get('uploads/files/:filename')
  async uploadedFile(@Param('filename') filename: string, @Res({ passthrough: true }) response: Response) {
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new NotFoundException('File not found');
    }
    try {
      const body = await fs.readFile(join(uploadDir, filename));
      response.setHeader('Content-Type', imageContentType(filename));
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return new StreamableFile(body);
    } catch {
      throw new NotFoundException('File not found');
    }
  }

  private upsertProduct(input: Row) {
    const timestamp = now();
    const product = {
      id: stringValue(input.id, id('product')),
      sku: stringValue(input.sku, stringValue(input.barcode, 'SKU')),
      barcode: stringValue(input.barcode, stringValue(input.sku)),
      name: stringValue(input.name, 'Unnamed Product'),
      price: numberValue(input.price, 0),
      originalPrice: input.originalPrice,
      memberPrice: input.memberPrice,
      promotionPrice: input.promotionPrice,
      promotionText: input.promotionText,
      imageUrl: input.imageUrl,
      customFields: input.customFields ?? {},
      defaultTemplateId: input.defaultTemplateId,
      status: input.status ?? 'active',
      createdAt: stringValue(input.createdAt, timestamp),
      updatedAt: timestamp,
    };
    this.db.cloudProducts.set(product.id, product);
    this.db.save();
    return product;
  }

  private upsertTemplate(input: Row) {
    const timestamp = now();
    const templateId = stringValue(input.id, id('template'));
    const template = {
      id: templateId,
      code: stringValue(input.code, `TPL_${Date.now()}`),
      name: stringValue(input.name, 'Default Template'),
      deviceType: stringValue(input.deviceType, 'ET0750-89'),
      width: numberValue(input.width, 800),
      height: numberValue(input.height, 480),
      dpi: numberValue(input.dpi, 120),
      colorMode: input.colorMode ?? 'bwry',
      status: input.status ?? 'draft',
      version: numberValue(input.version, 1),
      previewImageUrl: stringValue(input.previewImageUrl, this.templatePreviewUrl(templateId)),
      schema: input.schema ?? defaultSchema(input),
      recentVersions: input.recentVersions ?? [],
      createdAt: stringValue(input.createdAt, timestamp),
      updatedAt: timestamp,
    };
    template.schema = resizeSchemaToCanvas(
      template.schema as Row,
      template.width,
      template.height,
      template.deviceType,
      String(template.colorMode),
    );
    this.db.cloudTemplates.set(template.id, template);
    this.db.save();
    return template;
  }

  private async createRefreshTask(deviceId: string, taskType: string, parentTaskId?: string) {
    const label = this.findLabel(deviceId);
    const render = await this.renderTemplateForLabel(label);
    const task = {
      id: id('task'),
      taskType,
      eslDeviceId: deviceId,
      apId: label.apId,
      productId: (label as Label & Row).productId,
      templateId: (label as Label & Row).templateId,
      payload: { labelId: label.id, localRenderer: true },
      renderResult: {
        width: render.width,
        height: render.height,
        colorMode: render.colorMode,
        previewImageUrl: render.previewImageUrl,
      },
      retryCount: parentTaskId ? 1 : 0,
      status: 'queued',
      parentTaskId,
      triggeredAt: now(),
      createdAt: now(),
      updatedAt: now(),
      eslDevice: this.localDevice(label),
    } as Row;
    this.db.cloudTasks.set(String(task.id), task);
    const delivery = await this.deliverRefreshTask(label, render, task.id);
    task.status = delivery.ok ? 'sending' : 'failed';
    task.resultMsg = delivery.reason;
    task.delivery = delivery;
    task.updatedAt = now();
    if (delivery.commandId) {
      task.payload = { ...(task.payload as Row), commandId: delivery.commandId };
    }
    this.db.cloudTasks.set(String(task.id), task);
    this.db.save();
    return task;
  }

  private async deliverRefreshTask(label: Label, render: RenderedTemplateImage, taskId: unknown) {
    const apId = this.resolveDeliveryApId(label);
    if (!apId) {
      return { ok: false, reason: '没有在线基站，刷新任务无法下发' };
    }

    const packet = await this.buildLocalReadWritePacket(label.storeCode, apId, label.id, render);
    const command = this.db.createCommand({
      storeCode: label.storeCode,
      targetType: 'label',
      targetId: label.id,
      type: 'refresh_label',
      payload: { source: 'api/v1', taskId, render: { width: render.width, height: render.height }, localProtocol: packet.renderMode },
    });

    const wsResult = this.apWebsocket.sendRaw(apId, packet.command);

    const mqttResults = await Promise.all(packet.publishTopics.map(async (topic) => {
      try {
        await this.mqtt.publishJson(topic, packet.command, { retain: false });
        return { topic, ok: true };
      } catch (error) {
        return { topic, ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    }));

    this.db.recordRequest({
      method: 'LOCAL-IMAGE-DOWNLINK',
      path: `/ap/${apId}`,
      statusCode: wsResult.ok ? 200 : 503,
      body: {
        trackingId: wsResult.trackingId,
        apId,
        labelId: label.id,
        renderMode: packet.renderMode,
        imageFormat: packet.imageFormat,
        payloadBytes: packet.payloadBytes,
        imageBytes: packet.imageBytes,
        fit: packet.fit,
        resample: packet.resample,
        dither: packet.dither,
      },
    });

    const mqttOk = mqttResults.some((item) => item.ok);
    command.status = wsResult.ok || mqttOk ? 'sent' : 'failed';
    command.sentAt = new Date().toISOString();
    command.payload = { ...command.payload, mqttResults };
    this.db.commands.set(command.id, command);

    return {
      ok: wsResult.ok || mqttOk,
      reason: wsResult.ok
        ? `已下发（待执行确认），tracking=${wsResult.trackingId}，参数：${packet.renderMode} / ${packet.resample} / dither=${packet.dither}`
        : mqttOk
          ? `刷新任务已提交到本地 MQTT；当前没有可用 WebSocket 连接。参数：${packet.renderMode} / ${packet.resample} / dither=${packet.dither}`
          : `刷新任务下发失败：WebSocket 不可用，MQTT 发布失败（${mqttResults.find((item) => !item.ok)?.reason ?? 'unknown'}）。`,
      commandId: command.id,
      transport: wsResult.ok ? 'websocket-read-write-svc+mqtt' : mqttOk ? 'mqtt' : 'none',
      websocket: wsResult,
      mqtt: mqttResults,
      protocol: {
        topic: packet.topic,
        payloadBytes: packet.payloadBytes,
        imageBytes: packet.imageBytes,
        imageFormat: packet.imageFormat,
        renderMode: packet.renderMode,
      },
    };
  }

  private async buildLocalReadWritePacket(storeCode: string, apId: string, labelId: string, render: RenderedTemplateImage): Promise<LocalImagePacket> {
    const normalizedAp = apId.trim();
    const apUpper = normalizedAp.toUpperCase();
    const apNoColonUpper = normalizedAp.replace(/:/g, '').toUpperCase();
    const apNoColonLower = normalizedAp.replace(/:/g, '').toLowerCase();
    const topic = `${storeCode}/${normalizedAp}/cmd`;
    const publishTopics = [...new Set([
      topic,
      `${storeCode}/${apUpper}/cmd`,
      `${storeCode}/${apNoColonUpper}/cmd`,
      `${storeCode}/${apNoColonLower}/cmd`,
    ])];
    const preset = this.resolveScreenPreset(render);
    const sourceRgba = preset.service === '01-00-00-0c'
      ? await this.renderIntoService0cCanvas(render, preset.width, preset.height)
      : await this.transformRenderedRgba(render.rgba, render.width, render.height, preset.width, preset.height, preset.rotate, preset.mirrorX);
    const packedRows = preset.bpp === 1
      ? this.packImage1Bpp(sourceRgba, preset.width, preset.height)
      : this.packImage2Bpp(sourceRgba, preset.width, preset.height);
    const imageBytes = this.buildChunkedImageContainer(preset.magic, packedRows);
    const command: Row = {
      type: 'READ_WRITE_SVC',
      opas: [
        {
          addr: labelId.trim().toUpperCase(),
          cmds: [
            { id: 0, type: 'CONN_DEV' },
            {
              id: 16,
              type: 'WRITE_SVC',
              service: preset.service,
              b64dat: imageBytes.toString('base64'),
              ...(preset.supersize ? { supersize: true, mtu: preset.mtu ?? 10000 } : {}),
              ...(preset.service === '01-00-00-03' ? { bigsize: preset.bpp !== 1 } : {}),
            },
          ],
        },
      ],
    };

    return {
      topic,
      publishTopics,
      command,
      payloadBytes: Buffer.byteLength(JSON.stringify(command)),
      imageBytes: imageBytes.length,
      imageFormat: `${preset.service}/${preset.bpp}bpp`,
      renderMode: preset.mode,
      fit: 'stretch',
      resample: 'bilinear',
      dither: true,
      width: preset.width,
      height: preset.height,
    };
  }

  private async renderTemplateForLabel(label: Label, explicitTemplate?: Row): Promise<RenderedTemplateImage> {
    const row = label as Label & Row;
    const product = row.productId ? this.db.cloudProducts.get(String(row.productId)) ?? null : null;
    const template = explicitTemplate
      ?? (row.templateId ? this.db.cloudTemplates.get(String(row.templateId)) ?? null : null)
      ?? (product?.defaultTemplateId ? this.db.cloudTemplates.get(String(product.defaultTemplateId)) ?? null : null)
      ?? this.ensureDefaultTemplate();
    const schema = (template.schema && typeof template.schema === 'object' ? template.schema : defaultSchema(template)) as Row;
    const width = numberValue(template.width, 800);
    const height = numberValue(template.height, 480);
    const colorMode = stringValue(template.colorMode, 'bwry');
    const normalizedSchema = resizeSchemaToCanvas(schema, width, height, stringValue(template.deviceType, 'ET0750-89'), colorMode);
    const bindings = this.buildTemplateBindings(label, product);
    const svg = await this.renderTemplateSvg(normalizedSchema, bindings, width, height);
    const { data: rgba } = await sharp(Buffer.from(svg))
      .resize(width, height, { fit: 'fill', kernel: 'linear' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const quantized = this.quantizeRgba(Buffer.from(rgba), colorMode);
    const previewPng = await sharp(quantized, { raw: { width, height, channels: 4 } }).png().toBuffer();
    return {
      width,
      height,
      colorMode,
      svg,
      rgba: quantized,
      previewImageUrl: `data:image/png;base64,${previewPng.toString('base64')}`,
      bindings,
      template,
    };
  }

  private buildTemplateBindings(label: Label, product?: Row | null) {
    const source = product ?? {};
    const customFields = source.customFields && typeof source.customFields === 'object' ? source.customFields as Row : {};
    const price = numberValue(source.price, label.price);
    return {
      sourceId: stringValue(source.sourceId, stringValue(source.sku, label.sku ?? label.id)),
      id: label.id,
      eslCode: label.id,
      sku: stringValue(source.sku, label.sku ?? label.id),
      reference: stringValue(source.reference, stringValue(source.barcode, label.sku ?? label.id)),
      barcode: stringValue(source.barcode, label.sku ?? label.id),
      name: stringValue(source.name, label.title),
      title: stringValue(source.name, label.title),
      subName: stringValue(source.subName),
      brand: stringValue(source.brand),
      category: stringValue(source.category),
      price: price.toFixed(2),
      field1: price.toFixed(2),
      originalPrice: numberValue(source.originalPrice, price).toFixed(2),
      memberPrice: numberValue(source.memberPrice, price).toFixed(2),
      promotionPrice: numberValue(source.promotionPrice, price).toFixed(2),
      field2: numberValue(source.promotionPrice, price).toFixed(2),
      promotionText: stringValue(source.promotionText),
      unit: stringValue(source.unit),
      specification: stringValue(source.specification),
      imageUrl: stringValue(source.imageUrl),
      ...Object.fromEntries(Array.from({ length: 22 }, (_, index) => {
        const key = `customField${index + 1}`;
        return [key, stringValue(source[key], stringValue(customFields[key]))];
      })),
    };
  }

  private async renderTemplateSvg(schema: Row, bindings: Record<string, string>, width: number, height: number) {
    const elements = Array.isArray(schema?.elements) ? schema.elements as Row[] : [];
    const body = (await Promise.all(elements
      .filter((item) => item.visible !== false)
      .sort((left, right) => numberValue(left.zIndex, 0) - numberValue(right.zIndex, 0))
      .map((item) => this.renderPreviewElement(item, bindings))))
      .join('');
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      '<rect width="100%" height="100%" fill="#ffffff"/>',
      body,
      '</svg>',
    ].join('');
  }

  private resolveScreenPreset(render: RenderedTemplateImage) {
    const exact = SCREEN_PRESETS.find((preset) => preset.width === render.width && preset.height === render.height);
    if (exact) return exact;
    const rotated = SCREEN_PRESETS.find((preset) => preset.width === render.height && preset.height === render.width);
    if (rotated) return rotated;
    return SCREEN_PRESETS[0];
  }

  private async renderIntoService0cCanvas(render: RenderedTemplateImage, width: number, height: number) {
    return sharp(render.rgba, { raw: { width: render.width, height: render.height, channels: 4 } })
      .resize(width, height, { fit: 'fill', kernel: 'linear' })
      .ensureAlpha()
      .raw()
      .toBuffer();
  }

  private async transformRenderedRgba(rgba: Buffer, sourceWidth: number, sourceHeight: number, width: number, height: number, rotate: number, mirrorX: boolean) {
    let pipeline = sharp(rgba, { raw: { width: sourceWidth, height: sourceHeight, channels: 4 } });
    if (rotate) {
      pipeline = pipeline.rotate(rotate);
    }
    if (mirrorX) {
      pipeline = pipeline.flop();
    }
    return pipeline
      .resize(width, height, { fit: 'fill', kernel: 'linear' })
      .ensureAlpha()
      .raw()
      .toBuffer();
  }

  private quantizeRgba(rgba: Buffer, colorMode: string) {
    const output = Buffer.from(rgba);
    const palette = stringValue(colorMode).includes('y')
      ? [[0, 0, 0], [255, 255, 255], [255, 214, 0], [255, 0, 0]]
      : stringValue(colorMode).includes('r')
        ? [[0, 0, 0], [255, 255, 255], [255, 0, 0]]
        : [[0, 0, 0], [255, 255, 255]];
    for (let offset = 0; offset < output.length; offset += 4) {
      if (output[offset + 3] < 16) {
        output[offset] = 255;
        output[offset + 1] = 255;
        output[offset + 2] = 255;
        output[offset + 3] = 255;
        continue;
      }
      let best = palette[0];
      let bestDistance = Number.MAX_SAFE_INTEGER;
      for (const candidate of palette) {
        const dr = candidate[0] - output[offset];
        const dg = candidate[1] - output[offset + 1];
        const db = candidate[2] - output[offset + 2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
      output[offset] = best[0];
      output[offset + 1] = best[1];
      output[offset + 2] = best[2];
      output[offset + 3] = 255;
    }
    return output;
  }

  private packImage2Bpp(rgba: Buffer, width: number, height: number) {
    const output = Buffer.alloc(Math.ceil(width * height / 4), 0x55);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      const code = this.colorCode2Bpp(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
      const byteIndex = Math.floor(pixel / 4);
      const shift = (3 - (pixel % 4)) * 2;
      output[byteIndex] = (output[byteIndex] & ~(0b11 << shift)) | ((code & 3) << shift);
    }
    return output;
  }

  private colorCode2Bpp(r: number, g: number, b: number) {
    if (r < 80 && g < 80 && b < 80) return 0;
    if (r > 190 && g > 150 && b < 90) return 2;
    if (r > 180 && g < 110 && b < 110) return 3;
    return 1;
  }

  private packImage1Bpp(rgba: Buffer, width: number, height: number) {
    const rowBytes = Math.ceil(width / 8);
    const output = Buffer.alloc(rowBytes * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const lum = rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114;
        if (lum < 160) {
          output[y * rowBytes + Math.floor(x / 8)] |= 1 << (7 - (x % 8));
        }
      }
    }
    return output;
  }

  private buildChunkedImageContainer(magic: number, rows: Buffer) {
    const parts = [Buffer.from([0xa5, 0xa6, magic, 0x02])];
    const chunkSize = 8192;
    let chunkId = 1;
    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      const chunk = rows.subarray(offset, Math.min(rows.length, offset + chunkSize));
      const compressed = deflateRawSync(chunk, { level: 9 });
      const header = Buffer.alloc(3);
      header[0] = chunkId;
      header.writeUInt16LE(compressed.length, 1);
      parts.push(header, compressed);
      chunkId += 1;
    }
    return Buffer.concat(parts);
  }

  private resolveDeliveryApId(label: Label) {
    const candidates = [
      label.apId,
      ...[...this.db.baseStations.values()]
        .filter((item) => item.status === 'online')
        .map((item) => item.id),
    ].filter((item): item is string => Boolean(item));

    const uniqueCandidates = [...new Set(candidates)];
    const connected = uniqueCandidates.find((apId) => this.apWebsocket.getConnectionStatus(apId).connected);
    if (connected) return connected;

    const online = uniqueCandidates.find((apId) => this.db.baseStations.get(apId)?.status === 'online');
    return online ?? uniqueCandidates[0];
  }

  private templatePreviewUrl(templateId: string) {
    return `/api/v1/templates/${templateId}/preview-image?t=${Date.now()}`;
  }

  private async renderTemplatePreviewSvg(schema: Row) {
    const meta = (schema?.meta && typeof schema.meta === 'object' ? schema.meta : {}) as Row;
    const width = numberValue(meta.width, 296);
    const height = numberValue(meta.height, 128);
    return this.renderTemplateSvg(schema, {
      name: '商品名称',
      title: '商品名称',
      price: '19.90',
      sku: 'SKU',
      barcode: '6900000000000',
      imageUrl: '',
    }, width, height);
  }

  private async renderPreviewElement(item: Row, bindings: Record<string, string> = {}) {
    const type = String(item.type ?? 'text');
    const x = numberValue(item.x, 0);
    const y = numberValue(item.y, 0);
    const width = numberValue(item.width, 80);
    const height = numberValue(item.height, 24);
    const style = (item.style && typeof item.style === 'object' ? item.style : {}) as Row;
    const bindingField = stringValue(item.bindingField);
    const bindingKey = bindingField.replace(/^#/, '');
    const boundText = bindingField ? stringValue(bindings[bindingKey] ?? bindings[bindingField]) : '';
    if (type === 'image') {
      const href = bindingKey === 'imageUrl' && bindings.imageUrl ? bindings.imageUrl : stringValue(item.expression);
      const resolvedHref = await this.resolveImageDataUri(href);
      return resolvedHref ? `<image href="${escapeXml(resolvedHref)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>` : `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${escapeXml(style.background ?? '#ffffff')}"/>`;
    }
    if (type === 'rect') {
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${escapeXml(style.fill ?? style.background ?? '#ffffff')}" stroke="${escapeXml(style.stroke ?? '#111111')}"/>`;
    }
    if (type === 'line') {
      return `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y + height}" stroke="${escapeXml(style.stroke ?? '#111111')}" stroke-width="${numberValue(style.strokeWidth, 1)}"/>`;
    }
    if (type === 'barcode') {
      const fill = escapeXml(style.fill ?? '#111111');
      const stroke = escapeXml(style.stroke ?? '#111111');
      const background = escapeXml(style.background ?? '#ffffff');
      const text = escapeXml(boundText || stringValue(item.expression, stringValue(item.bindingField, 'barcode')));
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${background}" stroke="${stroke}" stroke-width="1"/><rect x="${x + 4}" y="${y + 4}" width="${Math.max(1, width - 8)}" height="${Math.max(1, height - 20)}" fill="${fill}"/><text x="${x + width / 2}" y="${y + height - 4}" text-anchor="middle" font-size="10" font-family="${SVG_FONT_STACK}" fill="${fill}">${text}</text>`;
    }
    if (type === 'qrcode') {
      const fill = escapeXml(style.fill ?? '#111111');
      const stroke = escapeXml(style.stroke ?? '#111111');
      const background = escapeXml(style.background ?? '#ffffff');
      const text = escapeXml(boundText || stringValue(item.expression, stringValue(item.bindingField, 'QR')));
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${background}" stroke="${stroke}" stroke-width="1"/><text x="${x + width / 2}" y="${y + height / 2 + 6}" text-anchor="middle" font-size="${Math.min(18, Math.max(10, Math.floor(height / 4)))}" font-weight="700" font-family="${SVG_FONT_STACK}" fill="${fill}">${text}</text>`;
    }
    const fontSize = numberValue(style.fontSize, type === 'price' ? 28 : 14);
    const fontWeight = String(style.fontWeight ?? '') === 'bold' ? '700' : '400';
    const fill = escapeXml(style.fill ?? '#111111');
    const stroke = escapeXml(style.stroke ?? '#111111');
    const background = escapeXml(style.background ?? '#ffffff');
    const textAlign = String(style.textAlign ?? 'left');
    const textAnchor = textAlign === 'center' ? 'middle' : textAlign === 'right' ? 'end' : 'start';
    const textX = textAlign === 'center' ? x + width / 2 : textAlign === 'right' ? x + width - 4 : x + 4;
    const text = type === 'price' ? `￥${boundText || '19.90'}` : (boundText || stringValue(item.expression, String(item.bindingField ?? type)));
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${background}" stroke="${stroke}" stroke-width="1"/><text x="${textX}" y="${y + fontSize}" text-anchor="${textAnchor}" font-size="${fontSize}" font-weight="${fontWeight}" font-family="${SVG_FONT_STACK}" fill="${fill}">${escapeXml(text)}</text>`;
  }

  private async resolveImageDataUri(value: string) {
    const source = stringValue(value);
    if (!source) return '';
    if (source.startsWith('data:image/')) return source;

    try {
      let body: Buffer;
      let contentType = 'image/png';
      const uploadMatch = source.match(/\/api\/v1\/uploads\/files\/([^/?#]+)/);
      if (uploadMatch?.[1]) {
        const filename = decodeURIComponent(uploadMatch[1]);
        body = await fs.readFile(join(uploadDir, filename));
        contentType = imageContentType(filename);
      } else {
        const url = source.startsWith('/')
          ? new URL(source, process.env.PUBLIC_SERVER_URL ?? 'http://localhost:4000').toString()
          : source;
        const response = await fetch(url);
        if (!response.ok) return '';
        const arrayBuffer = await response.arrayBuffer();
        body = Buffer.from(arrayBuffer);
        contentType = response.headers.get('content-type')?.split(';')[0] || imageContentType(url);
      }
      return `data:${contentType};base64,${body.toString('base64')}`;
    } catch {
      return '';
    }
  }

  private ensureDefaultTemplate() {
    const existing = [...this.db.cloudTemplates.values()][0];
    if (existing) return existing;
    return this.upsertTemplate({
      id: 'template_default_750_480',
      code: 'DEFAULT_750_480',
      name: 'Kersen 7.5 默认模板',
      deviceType: 'ET0750-89',
      width: 800,
      height: 480,
      colorMode: 'bwry',
      status: 'published',
    });
  }

  private localProducts(): Row[] {
    const products = [...this.db.cloudProducts.values()];
    for (const label of this.db.labels.values()) {
      const row = label as Label & Row;
      if (row.productId && products.some((item) => item.id === row.productId)) continue;
      products.push({
        id: row.productId ?? `product_${label.id}`,
        sku: label.sku ?? label.id,
        barcode: label.sku ?? label.id,
        name: label.title,
        price: label.price,
        status: 'active',
        createdAt: label.updatedAt,
        updatedAt: label.updatedAt,
      });
    }
    return products;
  }

  private localDevices(): LocalDevice[] {
    return [...this.db.labels.values()].map((label) => this.localDevice(label));
  }

  private localDevice(label: Label, includeAp = true): LocalDevice {
    const row = label as Label & Row;
    const product = row.productId ? this.db.cloudProducts.get(String(row.productId)) ?? null : null;
    const template = row.templateId ? this.db.cloudTemplates.get(String(row.templateId)) ?? null : null;
    const preset = this.resolveDevicePreset(stringValue(row.deviceType), template);
    const activeRecently = isRecentActivity(label.updatedAt);
    const status = activeRecently && label.status !== 'idle' ? label.status : 'offline';
    return {
      id: label.id,
      eslCode: label.id,
      name: label.title,
      apId: label.apId,
      productId: row.productId,
      templateId: row.templateId,
      deviceType: stringValue(row.deviceType, stringValue(template?.deviceType, preset.deviceType)),
      screenWidth: numberValue(row.screenWidth, numberValue(template?.width, preset.width)),
      screenHeight: numberValue(row.screenHeight, numberValue(template?.height, preset.height)),
      battery: label.battery ?? 100,
      signal: label.rssi ?? 0,
      bindStatus: row.productId || row.templateId ? 'bound' : 'unbound',
      status,
      lastRefreshAt: label.updatedAt,
      createdAt: label.updatedAt,
      updatedAt: label.updatedAt,
      product,
      template,
      ap: includeAp && label.apId ? this.localAp(this.findAp(label.apId, false)) : null,
    };
  }

  private localAps(): LocalAp[] {
    return [...this.db.baseStations.values()].map((ap) => this.localAp(ap));
  }

  private resolveDevicePreset(deviceType?: string, template?: Row | null) {
    const normalized = stringValue(deviceType).toUpperCase();
    const byType: Record<string, { deviceType: string; width: number; height: number }> = {
      ET0154: { deviceType: 'ET0154-80', width: 200, height: 200 },
      'ET0154-80': { deviceType: 'ET0154-80', width: 200, height: 200 },
      ET0213: { deviceType: 'ET0213-81', width: 250, height: 122 },
      'ET0213-81': { deviceType: 'ET0213-81', width: 250, height: 122 },
      ET0266: { deviceType: 'ET0266-82', width: 296, height: 152 },
      'ET0266-82': { deviceType: 'ET0266-82', width: 296, height: 152 },
      ET0290: { deviceType: 'ET0290-84', width: 296, height: 128 },
      'ET0290-84': { deviceType: 'ET0290-84', width: 296, height: 128 },
      ET0420: { deviceType: 'ET0420-87', width: 400, height: 300 },
      'ET0420-87': { deviceType: 'ET0420-87', width: 400, height: 300 },
      ET0580: { deviceType: 'ET0580-88', width: 648, height: 480 },
      'ET0580-88': { deviceType: 'ET0580-88', width: 648, height: 480 },
      ET0750: { deviceType: 'ET0750-89', width: 800, height: 480 },
      'ET0750-89': { deviceType: 'ET0750-89', width: 800, height: 480 },
    };
    return byType[normalized] ?? {
      deviceType: stringValue(template?.deviceType, 'KERSEN_296_128'),
      width: numberValue(template?.width, 296),
      height: numberValue(template?.height, 128),
    };
  }

  private localAp(ap: BaseStation): LocalAp;
  private localAp(ap?: BaseStation): LocalAp | null;
  private localAp(ap?: BaseStation): LocalAp | null {
    if (!ap) return null;
    const row = ap as BaseStation & Row;
    const devices = [...this.db.labels.values()]
      .filter((label) => label.apId === ap.id)
      .map((label) => this.localDevice(label, false));
    const latestHeartbeat = ap.lastSeenAt ?? now();
    const online = ap.status === 'online' && isRecentActivity(ap.lastSeenAt);
    return {
      id: ap.id,
      apCode: ap.id,
      name: ap.name,
      ip: ap.ip,
      mac: ap.mac,
      firmwareVersion: ap.firmware,
      location: row.location,
      config: row.config ?? {},
      status: online ? 'online' : 'offline',
      online,
      lastOnlineAt: ap.lastSeenAt,
      lastHeartbeatAt: latestHeartbeat,
      heartbeatIntervalSeconds: Number(process.env.AP_OFFLINE_AFTER_SECONDS ?? 90),
      deviceCount: devices.length,
      discoveredDeviceCount: devices.length,
      devices,
      boundDevices: devices.filter((item) => item.bindStatus === 'bound'),
      discoveredDevices: devices.map((item) => ({
        eslCode: item.eslCode,
        status: item.status,
        battery: item.battery,
        signal: item.signal,
        lastSeenAt: item.updatedAt,
        source: 'local',
      })),
      recentHeartbeats: [{
        id: `${ap.id}-latest`,
        createdAt: latestHeartbeat,
        status: online ? 'online' : 'offline',
        payloadJson: { ip: ap.ip, firmware: ap.firmware, hostAddr: ap.hostAddr },
      }],
      recentTasks: [...this.db.cloudTasks.values()].filter((item) => item.apId === ap.id).slice(0, 10),
      recentLogs: this.db.requestLogs
        .filter((log) => JSON.stringify(log).includes(ap.id))
        .slice(0, 80),
      createdAt: ap.lastSeenAt ?? now(),
      updatedAt: ap.lastSeenAt ?? now(),
    };
  }

  private labelFromProduct(product: Row): Label {
    return {
      id: stringValue(product.id, 'preview'),
      storeCode: [...this.db.stores.values()][0]?.code ?? 'local',
      sku: stringValue(product.sku),
      title: stringValue(product.name, 'Preview Product'),
      price: numberValue(product.price, 0),
      currency: 'CNY',
      status: 'idle',
      updatedAt: now(),
    };
  }

  private findProduct(productId: string) {
    const product = this.localProducts().find((item) => item.id === productId);
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private findTemplate(templateId: string) {
    this.ensureDefaultTemplate();
    const template = this.db.cloudTemplates.get(templateId);
    if (!template) throw new NotFoundException('Template not found');
    return this.ensureTemplatePreview(template);
  }

  private ensureTemplatePreview(template: Row): Row {
    const normalizedSchema = resizeSchemaToCanvas(
      (template.schema && typeof template.schema === 'object' ? template.schema : defaultSchema(template)) as Row,
      numberValue(template.width, 800),
      numberValue(template.height, 480),
      stringValue(template.deviceType, 'ET0750-89'),
      stringValue(template.colorMode, 'bwry'),
    );
    if (stringValue(template.previewImageUrl)) {
      const normalized: Row = { ...template, schema: normalizedSchema };
      this.db.cloudTemplates.set(String(normalized.id), normalized);
      this.db.save();
      return normalized;
    }
    const next: Row = {
      ...template,
      schema: normalizedSchema,
      previewImageUrl: this.templatePreviewUrl(String(template.id)),
    };
    this.db.cloudTemplates.set(String(next.id), next);
    this.db.save();
    return next;
  }

  private findLabel(deviceId: string) {
    const label = this.db.labels.get(deviceId);
    if (!label) throw new NotFoundException('Display node not found');
    return label;
  }

  private findAp(apId: string): BaseStation;
  private findAp(apId: string, required: false): BaseStation | undefined;
  private findAp(apId: string, required = true): BaseStation | undefined {
    const ap = this.db.baseStations.get(apId);
    if (!ap && required) throw new NotFoundException('AP not found');
    return ap;
  }
}
