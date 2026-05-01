import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { Response } from 'express';
import { MemoryStore } from '../../shared/memory-store';
import { BaseStation, Label } from '../../shared/models';
import { ApWebsocketService } from '../ap-websocket/ap-websocket.service';
import { LabelRendererService } from '../labels/label-renderer.service';
import { buildTaskEsl2Payload } from '../labels/esl-payload';
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

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const uploadDir = join(process.cwd(), 'uploads');

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
  const width = numberValue(template.width, 296);
  const height = numberValue(template.height, 128);
  const name = stringValue(template.name, 'Default Template');
  return {
    meta: {
      name,
      deviceType: stringValue(template.deviceType, 'KERSEN_296_128'),
      width,
      height,
      colorMode: stringValue(template.colorMode, 'bw'),
      version: numberValue(template.version, 1),
    },
    datasource: ['name', 'price', 'sku', 'barcode'],
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
      {
        id: 'title',
        type: 'text',
        x: 18,
        y: 16,
        width: width - 36,
        height: 28,
        rotate: 0,
        visible: true,
        zIndex: 2,
        bindingField: 'name',
        style: { fontSize: 18, fontWeight: 'bold', fill: '#111111' },
      },
      {
        id: 'price',
        type: 'price',
        x: 18,
        y: 54,
        width: width - 36,
        height: 42,
        rotate: 0,
        visible: true,
        zIndex: 3,
        bindingField: 'price',
        style: { fontSize: 34, fontWeight: 'bold', fill: '#111111' },
      },
      {
        id: 'barcode',
        type: 'barcode',
        x: 18,
        y: height - 28,
        width: Math.min(150, width - 36),
        height: 22,
        rotate: 0,
        visible: true,
        zIndex: 4,
        bindingField: 'barcode',
        style: {},
      },
    ],
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
  templatePreviewImage(@Param('templateId') templateId: string, @Res({ passthrough: true }) response: Response) {
    const template = this.findTemplate(templateId);
    response.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    return this.renderTemplatePreviewSvg(template.schema as Row);
  }

  @Post('templates/:templateId/preview')
  previewTemplate(@Param('templateId') templateId: string, @Body() body: Row) {
    const template = this.findTemplate(templateId);
    const sampleData = (body.sampleData && typeof body.sampleData === 'object' ? body.sampleData : {}) as Row;
    const label = this.labelFromProduct({
      id: 'preview',
      sku: stringValue(sampleData.sku, 'PREVIEW'),
      name: stringValue(sampleData.name, stringValue(template.name, 'Preview Product')),
      price: numberValue(sampleData.price, 19.9),
    });
    const render = this.renderer.render(label);
    return {
      previewImageUrl: render.png.dataUri,
      renderResult: {
        width: render.width,
        height: render.height,
        source: 'local-label-renderer',
        bitmap: render.bitmap,
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
    return { ok: true, status: ap.status };
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
      deviceType: stringValue(input.deviceType, 'KERSEN_296_128'),
      width: numberValue(input.width, 296),
      height: numberValue(input.height, 128),
      dpi: numberValue(input.dpi, 120),
      colorMode: input.colorMode ?? 'bw',
      status: input.status ?? 'draft',
      version: numberValue(input.version, 1),
      previewImageUrl: stringValue(input.previewImageUrl, this.templatePreviewUrl(templateId)),
      schema: input.schema ?? defaultSchema(input),
      recentVersions: input.recentVersions ?? [],
      createdAt: stringValue(input.createdAt, timestamp),
      updatedAt: timestamp,
    };
    this.db.cloudTemplates.set(template.id, template);
    this.db.save();
    return template;
  }

  private async createRefreshTask(deviceId: string, taskType: string, parentTaskId?: string) {
    const label = this.findLabel(deviceId);
    const render = this.renderer.render(label);
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
        previewImageUrl: render.png.dataUri,
        bitmap: render.bitmap,
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

  private async deliverRefreshTask(label: Label, render: ReturnType<LabelRendererService['render']>, taskId: unknown) {
    const apId = this.resolveDeliveryApId(label);
    if (!apId) {
      return { ok: false, reason: '没有在线基站，刷新任务无法下发' };
    }

    const packet = this.buildTaskEsl2Packet(label.storeCode, apId, label.id, render.bgraGzip.bgra_gzip_b64);
    const command = this.db.createCommand({
      storeCode: label.storeCode,
      targetType: 'label',
      targetId: label.id,
      type: 'refresh_label',
      payload: { source: 'api/v1', taskId, render: { width: render.width, height: render.height } },
    });

    const wsResult = this.apWebsocket.sendBinary(apId, packet.payloadBuffer, {
      type: 'taskESL2',
      topic: packet.topic,
      labelId: label.id,
      imageFormat: 'bgra-gzip',
    });

    const mqttResults = await Promise.all(packet.publishTopics.map(async (topic) => {
      try {
        await this.mqtt.publishBinary(topic, packet.payloadBuffer, { retain: false, qos: 1 });
        return { topic, ok: true };
      } catch (error) {
        return { topic, ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    }));

    const mqttOk = mqttResults.some((item) => item.ok);
    command.status = wsResult.ok || mqttOk ? 'sent' : 'failed';
    command.sentAt = new Date().toISOString();
    command.payload = { ...command.payload, mqttResults };
    this.db.commands.set(command.id, command);

    return {
      ok: wsResult.ok || mqttOk,
      reason: wsResult.ok
        ? '刷新任务已通过本地 WebSocket 下发，正在等待基站返回执行结果。'
        : mqttOk
          ? '刷新任务已提交到本地 MQTT taskESL2；当前没有可用 WebSocket 连接。'
          : `刷新任务下发失败：WebSocket 不可用，MQTT 发布失败（${mqttResults.find((item) => !item.ok)?.reason ?? 'unknown'}）。`,
      commandId: command.id,
      transport: wsResult.ok ? 'websocket+mqtt' : mqttOk ? 'mqtt' : 'none',
      websocket: wsResult,
      mqtt: mqttResults,
      protocol: {
        topic: packet.topic,
        alternateTopics: packet.alternateTopics,
        payloadBytes: packet.payloadBuffer.length,
        imageBytes: packet.imageBytes,
      },
    };
  }

  private buildTaskEsl2Packet(storeCode: string, apId: string, labelId: string, bgraGzipBase64: string) {
    const normalizedAp = apId.trim();
    const apUpper = normalizedAp.toUpperCase();
    const apNoColonUpper = normalizedAp.replace(/:/g, '').toUpperCase();
    const apNoColonLower = normalizedAp.replace(/:/g, '').toLowerCase();
    const topic = `/estation/${apUpper}/taskESL2`;
    const publishTopics = [...new Set([
      topic,
      `/estation/${normalizedAp}/taskESL2`,
      `/estation/${apNoColonUpper}/taskESL2`,
      `/estation/${apNoColonLower}/taskESL2`,
    ])];
    const imageBytes = Buffer.from(bgraGzipBase64, 'base64');
    const protocolPayload = buildTaskEsl2Payload({
      tagIds: [labelId.trim().toUpperCase()],
      pattern: 0,
      pageIndex: 0,
      imageBytes,
      compress: true,
      tokenSeed: Date.now(),
    });
    return {
      topic,
      alternateTopics: publishTopics.filter((item) => item !== topic),
      publishTopics,
      payloadBuffer: Buffer.from(protocolPayload.payloadBytes),
      imageBytes: imageBytes.length,
      storeCode,
      apId,
    };
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

  private renderTemplatePreviewSvg(schema: Row) {
    const meta = (schema?.meta && typeof schema.meta === 'object' ? schema.meta : {}) as Row;
    const width = numberValue(meta.width, 296);
    const height = numberValue(meta.height, 128);
    const elements = Array.isArray(schema?.elements) ? schema.elements as Row[] : [];
    const body = elements
      .filter((item) => item.visible !== false)
      .sort((left, right) => numberValue(left.zIndex, 0) - numberValue(right.zIndex, 0))
      .map((item) => this.renderPreviewElement(item))
      .join('');
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      '<rect width="100%" height="100%" fill="#ffffff"/>',
      body,
      '</svg>',
    ].join('');
  }

  private renderPreviewElement(item: Row) {
    const type = String(item.type ?? 'text');
    const x = numberValue(item.x, 0);
    const y = numberValue(item.y, 0);
    const width = numberValue(item.width, 80);
    const height = numberValue(item.height, 24);
    const style = (item.style && typeof item.style === 'object' ? item.style : {}) as Row;
    if (type === 'image') {
      const href = stringValue(item.expression);
      return href ? `<image href="${escapeXml(href)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>` : '';
    }
    if (type === 'rect') {
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${escapeXml(style.fill ?? style.background ?? '#ffffff')}" stroke="${escapeXml(style.stroke ?? '#111111')}"/>`;
    }
    if (type === 'line') {
      return `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y + height}" stroke="${escapeXml(style.stroke ?? '#111111')}" stroke-width="${numberValue(style.strokeWidth, 1)}"/>`;
    }
    if (type === 'barcode') {
      return `<rect x="${x}" y="${y}" width="${width}" height="${Math.max(1, height - 14)}" fill="#111111"/><text x="${x + width / 2}" y="${y + height}" text-anchor="middle" font-size="10" fill="#111111">${escapeXml(item.expression ?? item.bindingField ?? 'barcode')}</text>`;
    }
    const fontSize = numberValue(style.fontSize, type === 'price' ? 28 : 14);
    const fontWeight = String(style.fontWeight ?? '') === 'bold' ? '700' : '400';
    const fill = escapeXml(style.fill ?? '#111111');
    const text = type === 'price' ? '￥19.90' : stringValue(item.expression, String(item.bindingField ?? type));
    return `<text x="${x}" y="${y + fontSize}" font-size="${fontSize}" font-weight="${fontWeight}" font-family="Arial, sans-serif" fill="${fill}">${escapeXml(text)}</text>`;
  }

  private ensureDefaultTemplate() {
    if (this.db.cloudTemplates.size > 0) return;
    this.upsertTemplate({
      id: 'template_default_296x128',
      code: 'DEFAULT_296_128',
      name: 'Kersen 296x128 默认模板',
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
    return {
      id: label.id,
      eslCode: label.id,
      name: label.title,
      apId: label.apId,
      productId: row.productId,
      templateId: row.templateId,
      deviceType: stringValue(row.deviceType, 'KERSEN_296_128'),
      screenWidth: 296,
      screenHeight: 128,
      battery: label.battery ?? 100,
      signal: label.rssi ?? 0,
      bindStatus: row.productId || row.templateId ? 'bound' : 'unbound',
      status: label.status === 'idle' ? 'offline' : label.status,
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

  private localAp(ap: BaseStation): LocalAp;
  private localAp(ap?: BaseStation): LocalAp | null;
  private localAp(ap?: BaseStation): LocalAp | null {
    if (!ap) return null;
    const row = ap as BaseStation & Row;
    const devices = [...this.db.labels.values()]
      .filter((label) => label.apId === ap.id)
      .map((label) => this.localDevice(label, false));
    const latestHeartbeat = ap.lastSeenAt ?? now();
    return {
      id: ap.id,
      apCode: ap.id,
      name: ap.name,
      ip: ap.ip,
      mac: ap.mac,
      firmwareVersion: ap.firmware,
      location: row.location,
      config: row.config ?? {},
      status: ap.status === 'online' ? 'online' : 'offline',
      online: ap.status === 'online',
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
        status: ap.status,
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
    if (stringValue(template.previewImageUrl)) {
      return template;
    }
    const next: Row = {
      ...template,
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
