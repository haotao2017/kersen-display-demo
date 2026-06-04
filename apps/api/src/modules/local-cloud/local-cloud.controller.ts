import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query, Req, Res, Sse, StreamableFile, UnauthorizedException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import sharp = require('sharp');
import bwipjs = require('bwip-js');
import QRCode = require('qrcode');
import { MemoryStore } from '../../shared/memory-store';
import { BaseStation, Label, StoreConfig } from '../../shared/models';
import { ApWebsocketService } from '../ap-websocket/ap-websocket.service';
import { LabelRendererService } from '../labels/label-renderer.service';
import { MqttService } from '../mqtt/mqtt.service';
import { RefreshQueueService } from '../refresh-queue/refresh-queue.service';

type Row = Record<string, unknown>;
type UserRole = 'ADMIN' | 'OPERATOR' | 'VIEWER';
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
  clearBeforeWrite: boolean;
  imageFormat: string;
  renderMode: string;
  fit: string;
  resample: string;
  dither: boolean;
  width: number;
  height: number;
};
type ScreenPreset = {
  key: string;
  width: number;
  height: number;
  service: '01-00-00-03' | '01-00-00-0c';
  magic: number;
  bpp: 1 | 2;
  colorMode: 'bw' | 'bwr' | 'bwry';
  packing?: '1bpp' | '2bpp' | 'bwr_planes';
  supersize?: boolean;
  mtu?: number;
  rotate: number;
  mirrorX: boolean;
  mode: string;
};
type SilentWakeResult = {
  labelId: string;
  trackingId?: string;
  ok: boolean;
  state: 'online' | 'offline' | 'waking' | 'unknown';
  stage: 'conn_dev_ok' | 'conn_dev_failed' | 'timeout' | 'not_sent';
  detail: string;
  errno?: number;
  cmdType?: string;
  traceStatus?: string;
};

const now = () => new Date().toISOString();
// 显示节点分组：去空格，最长 10 个字符（不允许超过 10 个字）
const normalizeGroup = (value: unknown): string | undefined => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 10) : undefined;
};
const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const getUploadDir = () => process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
const DEFAULT_TEMPLATE_ID = 'template_default_750_480';
const DEFAULT_TEMPLATE_DELETED_MARKER = '.default-template-deleted';
const SVG_FONT_STACK = 'Arial, Microsoft YaHei, sans-serif';
const OFFLINE_AFTER_MS = Number(process.env.AP_OFFLINE_AFTER_SECONDS ?? 90) * 1000;
const LABEL_OFFLINE_AFTER_MS = Math.max(180_000, Math.min(900_000, Number(process.env.LABEL_OFFLINE_AFTER_SECONDS ?? 300) * 1000));
const REFRESH_DEFERRED_RETRY_DELAY_MS = Math.max(5_000, Math.min(300_000, Number(process.env.ESL_REFRESH_DEFERRED_RETRY_DELAY_MS ?? 30_000)));
const REFRESH_DEFERRED_RETRY_MAX = Math.max(1, Math.min(20, Number(process.env.ESL_REFRESH_DEFERRED_RETRY_MAX ?? 10)));
const AP_ONLINE_LABEL_TRUST_DELAY_MS = Math.max(0, Math.min(900_000, Number(process.env.AP_ONLINE_LABEL_TRUST_DELAY_MS ?? 600_000)));
const LABEL_ONLINE_STABLE_MS = Math.max(60_000, Math.min(3_600_000, Number(process.env.LABEL_ONLINE_STABLE_SECONDS ?? 900) * 1000));
const LABEL_OFFLINE_PROBE_RETRY_DELAY_MS = Math.max(5_000, Math.min(300_000, Number(process.env.LABEL_OFFLINE_PROBE_RETRY_DELAY_MS ?? 30_000)));
const LABEL_OFFLINE_PROBE_MAX = Math.max(1, Math.min(10, Number(process.env.LABEL_OFFLINE_PROBE_MAX ?? 3)));

const SCREEN_PRESETS: ScreenPreset[] = [
  { key: '17900170', width: 800, height: 480, service: '01-00-00-0c', magic: 0x0c, bpp: 2, colorMode: 'bwry', packing: '2bpp', supersize: true, mtu: 10000, rotate: 0, mirrorX: false, mode: '0C 800x480' },
  { key: '1770008e', width: 648, height: 480, service: '01-00-00-03', magic: 0x0a, bpp: 2, colorMode: 'bwry', packing: '2bpp', rotate: 0, mirrorX: false, mode: '03-0A 648x480#b0y2r3w1' },
  { key: '176002f7', width: 400, height: 300, service: '01-00-00-03', magic: 0x04, bpp: 2, colorMode: 'bwry', packing: '2bpp', rotate: 0, mirrorX: false, mode: '03-04 400x300#b0y2r3w1' },
  { key: '17500175', width: 240, height: 416, service: '01-00-00-03', magic: 0x04, bpp: 2, colorMode: 'bwry', packing: '2bpp', rotate: 90, mirrorX: true, mode: '03-04 240x416#b0y2r3w1' },
  { key: '174004d2', width: 184, height: 384, service: '01-00-00-03', magic: 0x03, bpp: 2, colorMode: 'bwry', packing: '2bpp', rotate: 90, mirrorX: false, mode: '03-03 184x384#b0y2r3w1' },
  { key: '17200227', width: 152, height: 296, service: '01-00-00-03', magic: 0x02, bpp: 2, colorMode: 'bwry', packing: '2bpp', rotate: 90, mirrorX: true, mode: '03-02 152x296#b0y2r3w1' },
  { key: '173014d6', width: 128, height: 296, service: '01-00-00-03', magic: 0x02, bpp: 2, colorMode: 'bwry', packing: '2bpp', rotate: 90, mirrorX: true, mode: '03-02 128x296#b0y2r3w1' },
  { key: '1700009f', width: 200, height: 200, service: '01-00-00-03', magic: 0x02, bpp: 2, colorMode: 'bwry', packing: '2bpp', rotate: 90, mirrorX: false, mode: '03-02 200x200#b0y2r3w1' },
  { key: '14371296', width: 128, height: 250, service: '01-00-00-03', magic: 0x01, bpp: 1, colorMode: 'bwr', packing: 'bwr_planes', rotate: 90, mirrorX: false, mode: '03-01 128x250#bwrplanes' },
  { key: '1710408c', width: 128, height: 250, service: '01-00-00-03', magic: 0x01, bpp: 2, colorMode: 'bwry', packing: '2bpp', rotate: 90, mirrorX: false, mode: '03-01 128x250#b0y2r3w1' },
  { key: '15403fca', width: 128, height: 250, service: '01-00-00-03', magic: 0x01, bpp: 1, colorMode: 'bw', packing: '1bpp', rotate: 90, mirrorX: false, mode: '03 128x250' },
];

const LABEL_PRESET_KEYS: Record<string, string> = {
  '17900170': '17900170',
  '1770008e': '1770008e',
  '176002f7': '176002f7',
  '17500175': '17500175',
  '174004d2': '174004d2',
  '173014d6': '173014d6',
  '17200227': '17200227',
  '1710408c': '1710408c',
  '14371296': '14371296',
  '1700009f': '1700009f',
  '15403fca': '15403fca',
};

const LABEL_PREFIX_PRESET_KEYS: Array<{ prefix: string; key: string }> = [
  { prefix: '179', key: '17900170' },
  { prefix: '177', key: '1770008e' },
  { prefix: '176', key: '176002f7' },
  { prefix: '175', key: '17500175' },
  { prefix: '174', key: '174004d2' },
  { prefix: '173', key: '173014d6' },
  { prefix: '172', key: '17200227' },
  { prefix: '171', key: '1710408c' },
  { prefix: '143', key: '14371296' },
  { prefix: '170', key: '1700009f' },
  { prefix: '154', key: '15403fca' },
];

function paginationParams(query?: Row) {
  const page = Math.max(1, Math.floor(numberValue(query?.page, 1)));
  const pageSize = Math.max(1, Math.min(2000, Math.floor(numberValue(query?.pageSize, 50))));
  return {
    page,
    pageSize,
    start: (page - 1) * pageSize,
    end: page * pageSize,
  };
}

function paginate<T>(items: T[], query?: Row) {
  const { page, pageSize, start, end } = paginationParams(query);
  return {
    items: items.slice(start, end),
    page,
    pageSize,
    total: items.length,
  };
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function bindingTextValue(value: unknown, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value.trim() ? value.trim() : fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return fallback;
}

function normalizeRole(value: unknown, fallback: UserRole = 'VIEWER'): UserRole {
  const role = stringValue(value, fallback).toUpperCase();
  return role === 'ADMIN' || role === 'OPERATOR' || role === 'VIEWER' ? role : fallback;
}

function normalizeMacValue(value?: unknown) {
  const raw = stringValue(value).toLowerCase();
  if (!raw) {
    return '';
  }
  const hex = raw.replace(/[^a-f0-9]/g, '');
  if (hex.length !== 12) {
    return raw;
  }
  return hex.match(/.{1,2}/g)?.join(':') ?? raw;
}

function normalizeProductStatus(value: unknown): 'active' | 'inactive' {
  const s = String(value ?? '').trim();
  if (s === '1' || s.toLowerCase() === 'active') return 'active';
  if (s === '0' || s.toLowerCase() === 'inactive') return 'inactive';
  return 'active';
}

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readBool(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' ? true : value === 'false' ? false : fallback;
  return fallback;
}

function isRecentActivity(value?: string) {
  if (!value) {
    return false;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) && Date.now() - time <= OFFLINE_AFTER_MS;
}

function isWithinMs(value: unknown, maxAgeMs: number) {
  const time = new Date(String(value ?? '')).getTime();
  return Number.isFinite(time) && Date.now() - time <= maxAgeMs;
}

function apAutoImportEnabled(ap?: BaseStation | null) {
  const config = ap?.config && typeof ap.config === 'object' ? ap.config as Row : {};
  return config.autoImportScannedLabels === true;
}

function labelStatusValue(value: unknown): Label['status'] {
  const status = stringValue(value, 'online');
  return status === 'idle' || status === 'updating' || status === 'online' || status === 'offline' || status === 'failed'
    ? status
    : 'online';
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function averageRssiValue(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const readings = value.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item !== 0);
  if (!readings.length) return undefined;
  return Math.round(readings.reduce((sum, item) => sum + item, 0) / readings.length);
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

function boolValue(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function estimateSvgTextWidth(text: string, fontSize: number, fontWeight: string) {
  const weightBoost = fontWeight === '700' ? 1.08 : 1;
  let width = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fff\uff00-\uffef]/.test(char)) {
      width += fontSize;
    } else if (/[A-Z0-9￥$]/i.test(char)) {
      width += fontSize * 0.62;
    } else if (/\s/.test(char)) {
      width += fontSize * 0.34;
    } else {
      width += fontSize * 0.5;
    }
  }
  return width * weightBoost;
}

function measureSvgTextBox(text: string, fontSize: number, fontWeight: string) {
  const lines = text.split(/\r?\n/);
  const width = Math.max(1, ...lines.map((line) => estimateSvgTextWidth(line || ' ', fontSize, fontWeight)));
  return {
    width: Math.ceil(width + 8),
    height: Math.ceil(Math.max(1, lines.length) * fontSize * 1.18),
  };
}

function wrapSvgText(text: string, maxWidth: number, fontSize: number, fontWeight: string) {
  if (maxWidth <= 0) return [];
  const output: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let current = '';
    for (const char of rawLine) {
      const candidate = `${current}${char}`;
      if (current && estimateSvgTextWidth(candidate, fontSize, fontWeight) > maxWidth) {
        output.push(current);
        current = char;
      } else {
        current = candidate;
      }
    }
    output.push(current || ' ');
  }
  return output;
}

function svgToDataUri(svg: string) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function fitSvgImage(svg: string, x: number, y: number, width: number, height: number, preserveAspectRatio = 'xMidYMid meet') {
  return `<image href="${escapeXml(svgToDataUri(svg))}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="${preserveAspectRatio}"/>`;
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
      colorMode: stringValue(template.colorMode, 'bwr'),
      version: numberValue(template.version, 1),
    },
    datasource: ['name', 'price', 'sku', 'barcode', 'imageUrl'],
    elements: [],
  };
}

function migrateLegacyOwners(data: {
  stores: StoreConfig[];
  baseStations: BaseStation[];
  labels: Label[];
  cloudProducts: Array<Record<string, unknown>>;
  cloudTemplates: Array<Record<string, unknown>>;
  cloudTasks: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
}) {
  const admin = data.users.find((user) => normalizeRole(user.role) === 'ADMIN' && String(user.username ?? '') === 'admin')
    ?? data.users.find((user) => normalizeRole(user.role) === 'ADMIN')
    ?? data.users[0];
  const defaultOwnerId = String(admin?.id ?? '');
  if (!defaultOwnerId) return;

  for (const store of data.stores) {
    const row = store as StoreConfig & Row;
    row.ownerUserId = stringValue(row.ownerUserId, defaultOwnerId);
  }
  for (const ap of data.baseStations) {
    const row = ap as BaseStation & Row;
    row.ownerUserId = stringValue(row.ownerUserId, String((data.stores.find((store) => store.code === ap.storeCode) as Row | undefined)?.ownerUserId ?? defaultOwnerId));
  }
  for (const label of data.labels) {
    const row = label as Label & Row;
    const ap = label.apId ? data.baseStations.find((item) => item.id === label.apId) as Row | undefined : undefined;
    row.ownerUserId = stringValue(row.ownerUserId, String(ap?.ownerUserId ?? (data.stores.find((store) => store.code === label.storeCode) as Row | undefined)?.ownerUserId ?? defaultOwnerId));
  }
  for (const product of data.cloudProducts) {
    product.ownerUserId = stringValue(product.ownerUserId, String((data.stores.find((store) => store.code === product.storeCode) as Row | undefined)?.ownerUserId ?? defaultOwnerId));
  }
  for (const template of data.cloudTemplates) {
    template.ownerUserId = stringValue(template.ownerUserId, String((data.stores.find((store) => store.code === template.storeCode) as Row | undefined)?.ownerUserId ?? defaultOwnerId));
  }
  for (const task of data.cloudTasks) {
    const label = data.labels.find((item) => item.id === task.eslDeviceId) as Row | undefined;
    task.ownerUserId = stringValue(task.ownerUserId, String(label?.ownerUserId ?? defaultOwnerId));
  }
}

function ownershipFingerprint(snapshot: {
  stores: StoreConfig[];
  baseStations: BaseStation[];
  labels: Label[];
  cloudProducts: Row[];
  cloudTemplates: Row[];
  cloudTasks: Row[];
}) {
  return JSON.stringify({
    stores: snapshot.stores.map((item) => (item as unknown as Row).ownerUserId),
    baseStations: snapshot.baseStations.map((item) => (item as unknown as Row).ownerUserId),
    labels: snapshot.labels.map((item) => (item as unknown as Row).ownerUserId),
    products: snapshot.cloudProducts.map((item) => item.ownerUserId),
    templates: snapshot.cloudTemplates.map((item) => item.ownerUserId),
    tasks: snapshot.cloudTasks.map((item) => item.ownerUserId),
  });
}

function isAdminRoleValue(value: unknown) {
  return normalizeRole(value) === 'ADMIN';
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
  private readonly refreshWindowUntilByAp = new Map<string, number>();
  private readonly labelKeepaliveCursorByAp = new Map<string, number>();
  private readonly labelKeepaliveInFlightByAp = new Set<string>();
  private readonly deferredRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly labelOfflineProbeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private labelKeepaliveTimer?: ReturnType<typeof setInterval>;
  private taskCleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: MemoryStore,
    private readonly jwt: JwtService,
    private readonly renderer: LabelRendererService,
    private readonly mqtt: MqttService,
    private readonly apWebsocket: ApWebsocketService,
    private readonly refreshQueue: RefreshQueueService,
  ) {
    this.refreshQueue.registerHandler(({ taskId }) => this.executeQueuedRefreshTask(taskId));
    setTimeout(() => {
      this.ensureOwnershipBackfill();
      this.recoverDiscoveredLabelsFromRequestLogs();
      this.recoverLabelsFromDiscoveredCaches();
      void this.recoverQueuedRefreshTasks();
      this.startQueuedTaskReconciler();
      this.startLabelKeepaliveLoops();
      this.startTaskCleanupLoop();
    }, 1000);
  }

  @Post('auth/login')
  login(@Body() body: Row) {
    const storeCode = stringValue(body.storeCode, process.env.UPSTREAM_STORE_CODE ?? '20248517');
    const username = stringValue(body.username, 'admin');
    const user = this.findLoginUser(storeCode, username, false) ?? this.findLoginUser(undefined, username, false);
    if (!user || !bcrypt.compareSync(String(body.password ?? ''), String(user.passwordHash ?? ''))) {
      throw new NotFoundException('Invalid username or password');
    }
    if (String(user.status ?? 'active') === 'disabled') {
      throw new BadRequestException('User is disabled');
    }
    user.lastLoginAt = now();
    user.updatedAt = now();
    this.db.users.set(String(user.id), user);
    this.db.save();
    const store = this.db.stores.get(String(user.storeCode ?? '')) ?? [...this.db.stores.values()][0];
    return {
      accessToken: this.jwt.sign({ sub: user.id, storeCode: store?.code, username: user.username }),
      refreshToken: this.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: '30d' }),
      expiresIn: 28800,
      user: this.localUser(user),
    };
  }

  @Get('auth/invites/:token')
  inviteDetail(@Param('token') token: string) {
    const invite = this.findInviteByToken(token);
    this.assertInviteUsable(invite);
    return this.publicInvite(invite);
  }

  @Post('auth/register')
  register(@Body() body: Row) {
    const token = stringValue(body.token);
    const password = String(body.password ?? '');
    if (password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    const invite = this.findInviteByToken(token);
    this.assertInviteUsable(invite);
    const storeCode = stringValue(invite.storeCode);
    if (this.findLoginUser(undefined, String(invite.username), false)) {
      throw new BadRequestException('Username already exists');
    }

    const timestamp = now();
    const user = {
      id: id('user'),
      storeCode: storeCode || undefined,
      username: stringValue(invite.username),
      displayName: stringValue(body.displayName, stringValue(invite.displayName, stringValue(invite.username))),
      email: stringValue(body.email, stringValue(invite.email)) || undefined,
      role: normalizeRole(invite.role),
      status: 'active',
      passwordHash: bcrypt.hashSync(password, 10),
      createdAt: timestamp,
      updatedAt: timestamp,
      lastLoginAt: timestamp,
    };
    invite.usedAt = timestamp;
    invite.updatedAt = timestamp;
    invite.usedByUserId = user.id;
    this.db.users.set(user.id, user);
    this.db.userInvites.set(String(invite.id), invite);
    this.addAuditLog('users', 'register', user.id, null, this.localUser(user));
    this.db.save();

    return {
      accessToken: this.jwt.sign({ sub: user.id, storeCode: user.storeCode, username: user.username }),
      refreshToken: this.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: '30d' }),
      expiresIn: 28800,
      user: this.localUser(user),
    };
  }

  @Post('auth/refresh')
  refresh(@Body() body: Row) {
    const refreshToken = stringValue(body.refreshToken);
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }
    let decoded: Row;
    try {
      decoded = this.jwt.verify<Row>(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const userId = stringValue(decoded.sub);
    const user = userId ? this.db.users.get(userId) : undefined;
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const store = this.db.stores.get(String(user.storeCode ?? '')) ?? [...this.db.stores.values()][0];
    return {
      accessToken: this.jwt.sign({ sub: user.id, storeCode: store?.code, username: user.username }),
      refreshToken: this.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: '30d' }),
      expiresIn: 28800,
    };
  }

  @Sse('events/stream')
  eventStream() {
    return new Observable<{ type: string; data: Row }>((subscriber) => {
      subscriber.next({ type: 'connected', data: { ok: true, time: now() } });
      const timer = setInterval(() => {
        subscriber.next({ type: 'heartbeat', data: { ok: true, time: now() } });
      }, 25000);
      return () => clearInterval(timer);
    });
  }

  @Post('auth/logout')
  logout() {
    return true;
  }

  @Get('auth/me')
  me(@Req() request: Request) {
    return this.localUser(this.currentUser(request));
  }

  @Get('dashboard/summary')
  dashboard(@Req() request: Request) {
    const aps = this.localAps(request);
    const devices = this.visibleDeviceLabels(request).map((label) => this.localDeviceListItem(label, request));
    const today = new Date().toISOString().slice(0, 10);
    const tasks = this.visibleRows([...this.db.cloudTasks.values()], request);
    return {
      apOnlineCount: aps.filter((item) => item.online).length,
      apOfflineCount: aps.filter((item) => !item.online).length,
      deviceOnlineCount: devices.filter((item) => item.status !== 'idle' && item.status !== 'offline').length,
      deviceOfflineCount: devices.filter((item) => item.status === 'offline').length,
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
        message: this.taskUserMessage(task),
        related: String(task.eslDeviceId ?? ''),
      })),
    };
  }

  @Get('stores')
  stores(@Query() query: Row, @Req() request: Request) {
    return paginate(this.filterRowsByOwnerAndKeyword(this.localStores(request), query, ['name', 'code', 'address']), query);
  }

  @Post('stores')
  createStore(@Body() body: Row, @Req() request: Request) {
    const code = stringValue(body.code).trim();
    if (!/^\d+$/.test(code)) {
      throw new BadRequestException('门店号只能为数字');
    }
    if (this.db.stores.has(code)) {
      throw new BadRequestException('门店号已存在');
    }
    const timestamp = now();
    const fallback = [...this.db.stores.values()][0];
    const store: StoreConfig = {
      id: id('store'),
      code,
      name: stringValue(body.name, `门店 ${code}`),
      address: stringValue(body.address),
      username: stringValue(body.username, fallback?.username ?? 'admin'),
      passwordHash: fallback?.passwordHash ?? bcrypt.hashSync('admin123456', 10),
      serverUrl: stringValue(body.serverUrl, fallback?.serverUrl ?? process.env.PUBLIC_SERVER_URL ?? 'http://localhost:4000'),
      mqttTcpPort: numberValue(body.mqttTcpPort, fallback?.mqttTcpPort ?? Number(process.env.MQTT_TCP_PORT ?? 1883)),
      mqttWsPath: stringValue(body.mqttWsPath, fallback?.mqttWsPath ?? process.env.MQTT_WS_PATH ?? '/mqtt'),
      ownerUserId: this.ownerUserIdForWrite(body, request),
      createdAt: timestamp,
      updatedAt: timestamp,
    } as StoreConfig & Row;
    this.db.stores.set(store.code, store);
    this.db.save();
    return this.localStore(store, request);
  }

  @Put('stores/:code')
  updateStore(@Param('code') code: string, @Body() body: Row, @Req() request: Request) {
    const store = this.assertRowVisible(this.db.stores.get(code) as StoreConfig & Row | undefined, request, 'Store not found');
    const nextCode = stringValue(body.code, code).trim();
    if (!/^\d+$/.test(nextCode)) {
      throw new BadRequestException('门店号只能为数字');
    }
    if (nextCode !== code && this.db.stores.has(nextCode)) {
      throw new BadRequestException('门店号已存在');
    }
    const next: StoreConfig = {
      ...store,
      code: nextCode,
      name: stringValue(body.name, store.name),
      address: stringValue(body.address, store.address),
      updatedAt: now(),
    };
    if (nextCode !== code) {
      this.db.stores.delete(code);
      this.repointStoreReferences(code, nextCode);
    }
    this.db.stores.set(nextCode, next);
    this.db.save();
    return this.localStore(next, request);
  }

  @Delete('stores/:code')
  deleteStore(@Param('code') code: string, @Req() request: Request) {
    this.assertRowVisible(this.db.stores.get(code) as StoreConfig & Row | undefined, request, 'Store not found');
    this.db.stores.delete(code);
    this.deleteStoreReferences(code);
    this.db.save();
    return { deleted: true, code };
  }

  @Get('products')
  products(@Query() query: Row, @Req() request: Request) {
    const items = this.filterRowsByOwnerAndKeyword(this.localProducts(request), query, ['name', 'sku', 'barcode', 'status']);
    const sortBy  = stringValue(query.sortBy,    'updatedAt');
    const sortDir = stringValue(query.sortOrder, 'desc');
    items.sort((a: any, b: any) => {
      const av = String(a[sortBy] ?? '');
      const bv = String(b[sortBy] ?? '');
      return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
    });
    return paginate(items, query);
  }

  @Post('products')
  createProduct(@Body() body: Row, @Req() request: Request) {
    const ownerUserId = this.ownerUserIdForWrite(body, request);
    const storeCode = stringValue(body.storeCode, stringValue([...this.db.stores.values()][0]?.code));
    const sku = stringValue(body.sku, stringValue(body.barcode));
    const barcode = stringValue(body.barcode, sku);
    const duplicate = [...this.db.cloudProducts.values()].find((product) => (
      String(product.ownerUserId ?? '') === ownerUserId
      && stringValue(product.storeCode, storeCode) === storeCode
      && (
        (sku && stringValue(product.sku) === sku)
        || (barcode && stringValue(product.barcode) === barcode)
      )
    ));
    if (duplicate) {
      throw new BadRequestException('同一账号/门店下已存在相同来源编号或参考值的数据源');
    }
    const product = this.upsertProduct({ ...body, id: id('product'), ownerUserId });
    return product;
  }

  @Get('products/:productId')
  product(@Param('productId') productId: string, @Req() request: Request) {
    const product = this.assertRowVisible(this.findProduct(productId), request, 'Product not found');
    const boundLabels = [...this.db.labels.values()]
      .map((label) => label as Label & Row)
      .filter((label) => String(label.productId ?? '') === productId && this.canAccessRow(label, request));
    return {
      ...product,
      defaultTemplate: product.defaultTemplateId ? this.visibleRows([...this.db.cloudTemplates.values()], request).find((item) => item.id === product.defaultTemplateId) ?? null : null,
      bindDeviceCount: boundLabels.length,
      boundDevices: [],
    };
  }

  @Put('products/:productId')
  async updateProduct(@Param('productId') productId: string, @Body() body: Row, @Req() request: Request) {
    const current = this.assertRowVisible(this.findProduct(productId), request, 'Product not found');
    const product = this.upsertProduct({ ...current, ...body, id: productId });
    // Only trigger label refresh when display-relevant content actually changed
    const dataChanged = this.productContentChanged(current as Row, product as Row);
    const refresh = dataChanged
      ? this.refreshLinkedProductDevices(productId, 'product_update_refresh', request)
      : {
          attempted: false,
          boundDeviceCount: 0,
          refreshableDeviceCount: 0,
          skippedDeviceCount: 0,
          createdTaskCount: 0,
          taskIds: [] as string[],
          reasonCode: 'no_change' as const,
          message: '数据内容无变化，跳过标签刷新',
        };
    return {
      ...product,
      refresh,
    };
  }

  /** Returns true when any display-relevant product field has changed value. */
  private productContentChanged(before: Row, after: Row): boolean {
    const SCALAR_FIELDS = [
      'name', 'sku', 'barcode', 'price', 'originalPrice', 'memberPrice',
      'promotionPrice', 'promotionText', 'imageUrl', 'status', 'defaultTemplateId',
    ];
    for (const f of SCALAR_FIELDS) {
      const bv = before[f] == null ? '' : String(before[f]);
      const av = after[f] == null ? '' : String(after[f]);
      if (bv !== av) return true;
    }
    // Deep-compare customFields (flat key→value object)
    const bCF = (before.customFields as Record<string, unknown>) ?? {};
    const aCF = (after.customFields as Record<string, unknown>) ?? {};
    const allKeys = new Set([...Object.keys(bCF), ...Object.keys(aCF)]);
    for (const k of allKeys) {
      const bv = bCF[k] == null ? '' : String(bCF[k]);
      const av = aCF[k] == null ? '' : String(aCF[k]);
      if (bv !== av) return true;
    }
    return false;
  }

  @Get('products/:productId/delete-impact')
  productDeleteImpact(@Param('productId') productId: string, @Req() request: Request) {
    const product = this.assertRowVisible(this.findProduct(productId), request, 'Product not found');
    return this.productDeleteImpactPayload(product);
  }

  @Delete('products/:productId')
  deleteProduct(@Param('productId') productId: string, @Req() request: Request) {
    const product = this.assertRowVisible(this.findProduct(productId), request, 'Product not found');
    const impact = this.productDeleteImpactPayload(product);
    this.db.cloudProducts.delete(productId);
    for (const label of this.db.labels.values()) {
      const row = label as Label & Row;
      if (String(row.productId ?? '') === productId) {
        delete row.productId;
        row.updatedAt = now();
      }
    }
    for (const task of this.db.cloudTasks.values()) {
      if (String(task.productId ?? '') === productId) {
        delete task.productId;
      }
    }
    this.db.save();
    return { deleted: true, id: productId, impact };
  }

  @Post('products/:productId/refresh-linked-devices')
  refreshProduct(@Param('productId') productId: string, @Req() request: Request) {
    this.assertRowVisible(this.findProduct(productId), request, 'Product not found');
    return this.refreshLinkedProductDevices(productId, 'product_refresh', request);
  }

  @Get('templates')
  templates(@Query() query: Row, @Req() request: Request) {
    this.ensureDefaultTemplate();
    const templates = this.visibleRows([...this.db.cloudTemplates.values()], request).map((item) => this.localTemplate(item, request));
    return paginate(this.filterRowsByOwnerAndKeyword(templates, query, ['name', 'code', 'deviceType', 'status']), query);
  }

  @Post('templates')
  createTemplate(@Body() body: Row, @Req() request: Request) {
    const template = this.upsertTemplate({ ...body, id: id('template'), ownerUserId: this.ownerUserIdForWrite(body, request) });
    return template;
  }

  @Get('templates/:templateId')
  template(@Param('templateId') templateId: string, @Req() request: Request) {
    return this.assertRowVisible(this.findTemplate(templateId), request, 'Template not found');
  }

  @Get('templates/:templateId/delete-impact')
  templateDeleteImpact(@Param('templateId') templateId: string, @Req() request: Request) {
    const template = this.assertRowVisible(this.findTemplate(templateId), request, 'Template not found');
    return this.templateDeleteImpactPayload(template);
  }

  @Put('templates/:templateId')
  updateTemplate(@Param('templateId') templateId: string, @Body() body: Row, @Req() request: Request) {
    const current = this.assertRowVisible(this.findTemplate(templateId), request, 'Template not found');
    return this.upsertTemplate({ ...current, ...body, id: templateId });
  }

  @Get('templates/:templateId/schema')
  templateSchema(@Param('templateId') templateId: string, @Req() request: Request) {
    return { schema: this.assertRowVisible(this.findTemplate(templateId), request, 'Template not found').schema };
  }

  @Put('templates/:templateId/schema')
  saveTemplateSchema(@Param('templateId') templateId: string, @Body() body: Row, @Req() request: Request) {
    const current = this.assertRowVisible(this.findTemplate(templateId), request, 'Template not found');
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
  async templatePreviewImage(@Param('templateId') templateId: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const template = this.assertRowVisible(this.findTemplate(templateId), request, 'Template not found');
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
  async previewTemplate(@Param('templateId') templateId: string, @Body() body: Row, @Req() request: Request) {
    const template = this.assertRowVisible(this.findTemplate(templateId), request, 'Template not found');
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
  publishTemplate(@Param('templateId') templateId: string, @Body() body: Row, @Req() request: Request) {
    const current = this.assertRowVisible(this.findTemplate(templateId), request, 'Template not found');
    const template = this.upsertTemplate({
      ...current,
      status: 'published',
      version: numberValue(current.version, 1) + 1,
      previewImageUrl: this.templatePreviewUrl(templateId),
    });
    const refreshLinkedDevices = body.refreshLinkedDevices !== false;
    const refresh = refreshLinkedDevices
      ? this.refreshTemplateLinkedDevices(templateId, 'template_publish_refresh', request)
      : {
          attempted: false,
          boundDeviceCount: this.countTemplateLinkedLabels(templateId, request),
          refreshableDeviceCount: 0,
          skippedDeviceCount: 0,
          createdTaskCount: 0,
          taskIds: [],
          reasonCode: null,
          message: '模板已发布，未自动下发',
        };
    return { ok: true, template, refresh };
  }

  @Post('templates/:templateId/duplicate')
  duplicateTemplate(@Param('templateId') templateId: string, @Body() body: Row, @Req() request: Request) {
    const current = this.assertRowVisible(this.findTemplate(templateId), request, 'Template not found');
    return this.upsertTemplate({
      ...current,
      id: id('template'),
      name: stringValue(body.name, `${String(current.name)} Copy`),
      code: stringValue(body.code, `${String(current.code)}_copy`),
      status: 'draft',
    });
  }

  @Delete('templates/:templateId')
  async deleteTemplate(@Param('templateId') templateId: string, @Req() request: Request) {
    const template = this.assertRowVisible(this.findTemplate(templateId), request, 'Template not found');
    const impact = this.templateDeleteImpactPayload(template);
    this.db.cloudTemplates.delete(templateId);
    for (const product of this.db.cloudProducts.values()) {
      if (String(product.defaultTemplateId ?? '') === templateId) {
        product.defaultTemplateId = undefined;
      }
    }
    for (const label of this.db.labels.values()) {
      const row = label as Label & Row;
      if (String(row.templateId ?? '') === templateId) {
        delete row.templateId;
      }
    }
    if (templateId === DEFAULT_TEMPLATE_ID) {
      await this.markDefaultTemplateDeleted();
    }
    this.db.save();
    return { deleted: true, id: templateId, name: template.name, impact };
  }

  @Delete('templates/:templateId/versions/:versionId')
  deleteTemplateVersion(@Param('versionId') versionId: string) {
    return { deleted: true, versionId };
  }

  @Get('esl-devices')
  devices(@Query() query: Row, @Req() request: Request) {
    const labels = this.filterDeviceLabels(this.visibleDeviceLabels(request), query, request);
    const { page, pageSize, start, end } = paginationParams(query);
    return {
      items: labels.slice(start, end).map((label) => this.localDeviceListItem(label, request)),
      page,
      pageSize,
      total: labels.length,
    };
  }

  // 返回当前可见显示节点已有的全部分组（去重、排序），供前端分组筛选下拉框使用
  @Get('esl-devices/groups')
  deviceGroups(@Req() request: Request) {
    const groups = new Set<string>();
    for (const label of this.visibleDeviceLabels(request)) {
      const group = stringValue(label.group);
      if (group) groups.add(group);
    }
    return { items: [...groups].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')) };
  }

  @Post('esl-devices/batch-bind')
  async batchBindDevices(@Body() body: Row, @Req() request: Request) {
    const ids = this.bodyIds(body, 'deviceIds');
    if (!ids.length) throw new BadRequestException('请选择要绑定的显示节点');
    const productId = stringValue(body.productId);
    const templateId = stringValue(body.templateId);
    const product = productId ? this.assertRowVisible(this.findProduct(productId), request, 'Product not found') : null;
    if (templateId) {
      this.assertRowVisible(this.findTemplate(templateId), request, 'Template not found');
    }
    if (!product && !templateId) {
      throw new BadRequestException('请选择商品或模板');
    }

    const updatedIds: string[] = [];
    for (const deviceId of ids) {
      const label = this.assertRowVisible(this.findLabel(deviceId) as Label & Row, request, 'Display node not found');
      if (product) {
        label.productId = product.id;
        label.sku = stringValue(product.sku, label.sku);
        label.title = stringValue(product.name, label.title);
        label.price = numberValue(product.price, label.price);
      }
      if (templateId) {
        label.templateId = templateId;
      } else if (product && product.defaultTemplateId) {
        label.templateId = stringValue(product.defaultTemplateId);
      }
      label.updatedAt = now();
      this.db.labels.set(label.id, label);
      updatedIds.push(label.id);
    }
    this.db.save();
    return { updatedCount: updatedIds.length, deviceIds: updatedIds };
  }

  @Post('esl-devices/batch-unbind')
  batchUnbindDevices(@Body() body: Row, @Req() request: Request) {
    const ids = this.bodyIds(body, 'deviceIds');
    if (!ids.length) throw new BadRequestException('请选择要解绑的显示节点');
    let updatedCount = 0;
    for (const deviceId of ids) {
      const label = this.assertRowVisible(this.findLabel(deviceId) as Label & Row, request, 'Display node not found');
      delete label.productId;
      delete label.templateId;
      label.updatedAt = now();
      updatedCount += 1;
    }
    this.db.save();
    return { updatedCount };
  }

  @Delete('esl-devices/batch')
  batchDeleteDevices(@Body() body: Row, @Req() request: Request) {
    const ids = this.bodyIds(body, 'deviceIds');
    if (!ids.length) throw new BadRequestException('请选择要删除的显示节点');
    const impacts = ids.map((deviceId) => {
      const label = this.assertRowVisible(this.findLabel(deviceId) as Label & Row, request, 'Display node not found');
      return this.deviceDeleteImpactPayload(label);
    });
    for (const deviceId of ids) {
      this.db.labels.delete(deviceId);
      for (const task of this.db.cloudTasks.values()) {
        if (String(task.eslDeviceId ?? '') === deviceId) {
          delete task.eslDeviceId;
        }
      }
    }
    this.db.save();
    return { deletedCount: ids.length, impacts };
  }

  @Post('esl-devices')
  createDevice(@Body() body: Row, @Req() request: Request) {
    const apId = stringValue(body.apId) || undefined;
    if (apId) {
      this.assertRowVisible(this.findAp(apId, false) as (BaseStation & Row) | undefined, request, 'AP not found');
    }
    const storeCode = stringValue(
      body.storeCode,
      apId ? this.findAp(apId, false)?.storeCode : stringValue([...this.db.stores.values()][0]?.code),
    );
    this.assertRowVisible(this.db.stores.get(storeCode) as StoreConfig & Row | undefined, request, '门店不存在，请先创建门店');
    const label: Label & Row = {
      id: stringValue(body.eslCode, id('label')),
      storeCode,
      apId,
      ownerUserId: this.ownerUserIdForWrite(body, request),
      sku: stringValue(body.eslCode),
      title: stringValue(body.name, stringValue(body.eslCode, 'Display Node')),
      price: 0,
      currency: 'CNY',
      status: 'idle',
      battery: 100,
      updatedAt: now(),
      deviceType: stringValue(body.deviceType, 'KERSEN_296_128'),
      group: normalizeGroup(body.group),
    };
    this.db.labels.set(label.id, label);
    this.db.save();
    return this.localDevice(label, true, request);
  }

  @Get('esl-devices/:deviceId')
  device(@Param('deviceId') deviceId: string, @Req() request: Request) {
    const label = this.assertRowVisible(this.findLabel(deviceId) as Label & Row, request, 'Display node not found');
    return {
      ...this.localDevice(label, true, request),
      recentTasks: [...this.db.cloudTasks.values()]
        .filter((item) => item.eslDeviceId === deviceId && this.canAccessRow(item as Row, request))
        .map((item) => this.localTask(item, false)),
    };
  }

  @Put('esl-devices/:deviceId')
  updateDevice(@Param('deviceId') deviceId: string, @Body() body: Row, @Req() request: Request) {
    const label = this.assertRowVisible(this.findLabel(deviceId) as Label & Row, request, 'Display node not found');
    const nextApId = stringValue(body.apId) || undefined;
    label.id = stringValue(body.eslCode, label.id);
    label.title = stringValue(body.name, label.title);
    label.apId = nextApId;
    if (nextApId) {
      const ap = this.assertRowVisible(this.findAp(nextApId) as BaseStation & Row, request, 'AP not found');
      label.storeCode = ap.storeCode;
    }
    label.productId = stringValue(body.productId) || undefined;
    label.templateId = stringValue(body.templateId) || undefined;
    if ('group' in body) {
      label.group = normalizeGroup(body.group);
    }
    label.updatedAt = now();
    if (label.id !== deviceId) {
      this.db.labels.delete(deviceId);
    }
    this.db.labels.set(label.id, label);
    this.db.save();
    return this.localDevice(label, true, request);
  }

  @Post('esl-devices/:deviceId/bind')
  async bindDevice(@Param('deviceId') deviceId: string, @Body() body: Row, @Req() request: Request) {
    const label = this.assertRowVisible(this.findLabel(deviceId) as Label & Row, request, 'Display node not found');
    const product = this.assertRowVisible(this.findProduct(String(body.productId)), request, 'Product not found');
    label.productId = product.id;
    label.templateId = stringValue(body.templateId, stringValue(product.defaultTemplateId));
    label.sku = stringValue(product.sku, label.sku);
    label.title = stringValue(product.name, label.title);
    label.price = numberValue(product.price, label.price);
    label.updatedAt = now();
    this.db.labels.set(label.id, label);
    this.db.save();
    const productActive = normalizeProductStatus(product.status) === 'active';
    const task = body.autoRefresh === false || !productActive ? null : await this.createRefreshTask(label.id, 'bind_refresh');
    return { ...this.localDevice(label, true, request), recentTasks: task ? [this.localTask(task, false)] : [] };
  }

  @Post('esl-devices/:deviceId/unbind')
  unbindDevice(@Param('deviceId') deviceId: string, @Req() request: Request) {
    const label = this.assertRowVisible(this.findLabel(deviceId) as Label & Row, request, 'Display node not found');
    delete label.productId;
    delete label.templateId;
    label.updatedAt = now();
    this.db.save();
    return this.localDevice(label, true, request);
  }

  @Get('esl-devices/:deviceId/delete-impact')
  deviceDeleteImpact(@Param('deviceId') deviceId: string, @Req() request: Request) {
    const label = this.assertRowVisible(this.findLabel(deviceId) as Label & Row, request, 'Display node not found');
    return this.deviceDeleteImpactPayload(label);
  }

  @Delete('esl-devices/:deviceId')
  deleteDevice(@Param('deviceId') deviceId: string, @Req() request: Request) {
    const label = this.assertRowVisible(this.findLabel(deviceId) as Label & Row, request, 'Display node not found');
    const impact = this.deviceDeleteImpactPayload(label);
    this.db.labels.delete(deviceId);
    for (const task of this.db.cloudTasks.values()) {
      if (String(task.eslDeviceId ?? '') === deviceId) {
        delete task.eslDeviceId;
      }
    }
    this.db.save();
    return { deleted: true, id: deviceId, impact };
  }

  @Post('esl-devices/:deviceId/refresh')
  async refreshDevice(@Param('deviceId') deviceId: string, @Req() request: Request) {
    this.assertRowVisible(this.findLabel(deviceId) as Label & Row, request, 'Display node not found');
    const task = await this.createRefreshTask(deviceId, 'manual_refresh');
    return { ok: true, taskId: task.id };
  }

  @Post('esl-devices/:deviceId/silent-wake')
  async silentWakeDevice(@Param('deviceId') deviceId: string, @Body() body: Row, @Req() request: Request) {
    const label = this.assertRowVisible(this.findLabel(deviceId) as Label & Row, request, 'Display node not found');
    return this.runSilentWake([label.id], {
      apId: stringValue(body.apId, label.apId),
      waitMs: numberValue(body.waitMs, 8000),
      psmDurationMs: numberValue(body.psmDurationMs, 8000),
      sendMqtt: readBool(body.sendMqtt, true),
      sendWs: readBool(body.sendWs, true),
      disconnectAfterProbe: readBool(body.disconnectAfterProbe, true),
    });
  }

  @Post('labels/silent-wake')
  async silentWakeLabels(@Body() body: Row) {
    const labelIds = Array.isArray(body.labelIds)
      ? body.labelIds.map((item) => stringValue(item).toLowerCase()).filter(Boolean)
      : [stringValue(body.labelId).toLowerCase()].filter(Boolean);
    return this.runSilentWake(labelIds, {
      apId: stringValue(body.apId) || undefined,
      waitMs: numberValue(body.waitMs, 8000),
      psmDurationMs: numberValue(body.psmDurationMs, 8000),
      sendMqtt: readBool(body.sendMqtt, true),
      sendWs: readBool(body.sendWs, true),
      disconnectAfterProbe: readBool(body.disconnectAfterProbe, true),
    });
  }

  @Post('esl-devices/:deviceId/adjust')
  adjustDevice(@Param('deviceId') deviceId: string, @Req() request: Request) {
    this.assertRowVisible(this.findLabel(deviceId) as Label & Row, request, 'Display node not found');
    return { ok: true };
  }

  @Get('esl-devices/:deviceId/tasks')
  deviceTasks(@Param('deviceId') deviceId: string, @Query() query: Row, @Req() request: Request) {
    this.assertRowVisible(this.findLabel(deviceId) as Label & Row, request, 'Display node not found');
    const tasks = [...this.db.cloudTasks.values()]
      .filter((item) => item.eslDeviceId === deviceId && this.canAccessRow(item as Row, request))
      .reverse();
    const { page, pageSize, start, end } = paginationParams(query);
    return {
      items: tasks.slice(start, end).map((item) => this.localTaskListItem(item)),
      page,
      pageSize,
      total: tasks.length,
    };
  }

  @Get('aps')
  aps(@Query() query: Row, @Req() request: Request) {
    return paginate(this.filterAps(this.localAps(request), query), query);
  }

  @Post('aps')
  createAp(@Body() body: Row, @Req() request: Request) {
    const storeCode = stringValue(body.storeCode, [...this.db.stores.values()][0]?.code ?? 'local');
    this.assertRowVisible(this.db.stores.get(storeCode) as StoreConfig & Row | undefined, request, '门店不存在，请先创建门店');
    const requestedApCode = stringValue(body.apCode);
    const mac = normalizeMacValue(body.mac);
    const existingByMac = mac ? this.findApByMac(mac) as BaseStation & Row | undefined : undefined;
    const existingById = requestedApCode ? this.db.baseStations.get(requestedApCode) as BaseStation & Row | undefined : undefined;
    const apCode = requestedApCode || existingByMac?.id || id('ap');
    const current = existingByMac && existingByMac.id !== apCode
      ? this.renameApId(existingByMac.id, apCode)
      : existingById ?? existingByMac;
    const ap: BaseStation & Row = {
      id: apCode,
      storeCode,
      ownerUserId: this.ownerUserIdForWrite(body, request),
      name: stringValue(body.name, current?.name ?? apCode),
      ip: stringValue(body.ip) || current?.ip,
      mac: mac || current?.mac,
      firmware: stringValue(body.firmwareVersion) || current?.firmware,
      status: current?.status ?? 'offline',
      lastSeenAt: current?.lastSeenAt,
      metrics: current?.metrics ?? {},
      location: body.location ?? current?.location,
      config: {
        ...(current?.config && typeof current.config === 'object' ? current.config as Row : {}),
        ...(body.config && typeof body.config === 'object' ? body.config as Row : {}),
        autoImportScannedLabels: (current?.config as Row | undefined)?.autoImportScannedLabels === true,
      },
      discoveredLabels: current?.discoveredLabels ?? {},
    };
    this.db.baseStations.set(ap.id, ap);
    this.db.save();
    return this.localAp(ap, request);
  }

  @Get('aps/:apId')
  ap(@Param('apId') apId: string, @Req() request: Request) {
    return this.localAp(this.assertRowVisible(this.findAp(apId) as BaseStation & Row, request, 'AP not found'), request);
  }

  @Put('aps/:apId')
  updateAp(@Param('apId') apId: string, @Body() body: Row, @Req() request: Request) {
    const requestedApCode = stringValue(body.apCode);
    const ap = (requestedApCode && requestedApCode !== apId
      ? this.renameApId(apId, requestedApCode)
      : this.assertRowVisible(this.findAp(apId) as BaseStation & Row, request, 'AP not found')) as BaseStation & Row;
    ap.name = stringValue(body.name, ap.name);
    const storeCode = stringValue(body.storeCode, ap.storeCode);
    this.assertRowVisible(this.db.stores.get(storeCode) as StoreConfig & Row | undefined, request, '门店不存在，请先创建门店');
    ap.storeCode = storeCode;
    ap.ip = stringValue(body.ip) || ap.ip;
    ap.mac = normalizeMacValue(body.mac) || ap.mac;
    ap.firmware = stringValue(body.firmwareVersion) || ap.firmware;
    ap.location = body.location ?? ap.location;
    ap.config = {
      ...(ap.config ?? {}),
      ...(body.config && typeof body.config === 'object' ? body.config as Row : {}),
      autoImportScannedLabels: (ap.config as Row | undefined)?.autoImportScannedLabels === true,
    };
    this.db.save();
    return this.localAp(ap, request);
  }

  @Put('aps/:apId/auto-import-scanned-labels')
  updateApAutoImportScannedLabels(@Param('apId') apId: string, @Body() body: Row, @Req() request: Request) {
    const ap = this.assertRowVisible(this.findAp(apId) as BaseStation & Row, request, 'AP not found') as BaseStation & Row;
    const enabled = readBool(body.enabled, false);
    ap.config = {
      ...(ap.config && typeof ap.config === 'object' ? ap.config as Row : {}),
      autoImportScannedLabels: enabled,
    };
    this.db.baseStations.set(ap.id, ap);
    if (enabled) {
      this.importDiscoveredLabelsForAp(ap);
    }
    this.db.save();
    return this.localAp(ap, request);
  }

  @Post('aps/:apId/sync-status')
  syncAp(@Param('apId') apId: string, @Req() request: Request) {
    const ap = this.assertRowVisible(this.findAp(apId) as BaseStation & Row, request, 'AP not found');
    return { ok: true, status: this.localAp(ap, request)?.status ?? 'offline' };
  }

  @Post('aps/:apId/search-devices')
  searchDevices(@Param('apId') apId: string, @Req() request: Request) {
    const ap = this.assertRowVisible(this.findAp(apId) as BaseStation & Row, request, 'AP not found') as BaseStation & Row;
    if (apAutoImportEnabled(ap)) {
      this.importDiscoveredLabelsForAp(ap);
      this.db.save();
    }
    return { ok: true, devices: this.localDevices(request).filter((item) => item.apId === apId) };
  }

  @Post('aps/:apId/config')
  configAp(@Param('apId') apId: string, @Body() body: Row, @Req() request: Request) {
    const ap = this.assertRowVisible(this.findAp(apId) as BaseStation & Row, request, 'AP not found') as BaseStation & Row;
    const currentConfig = ap.config && typeof ap.config === 'object' ? ap.config as Row : {};
    ap.config = {
      ...(body.config && typeof body.config === 'object' ? body.config as Row : {}),
      autoImportScannedLabels: currentConfig.autoImportScannedLabels === true,
    };
    this.db.save();
    return this.localAp(ap, request);
  }

  @Post('aps/:apId/unbind-devices')
  unbindApDevices(@Param('apId') apId: string, @Req() request: Request) {
    this.assertRowVisible(this.findAp(apId) as BaseStation & Row, request, 'AP not found');
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
  transferApOwner(@Param('apId') apId: string, @Body() body: Row, @Req() request: Request) {
    this.requireAdminUser(request);
    const targetUserId = stringValue(body.targetUserId);
    const targetUser = this.findUser(targetUserId);
    const ap = this.findAp(apId) as BaseStation & Row;
    ap.ownerUserId = targetUserId;
    let transferredDeviceCount = 0;
    for (const label of this.db.labels.values()) {
      const row = label as Label & Row;
      if (row.apId === apId) {
        row.ownerUserId = targetUserId;
        transferredDeviceCount += 1;
      }
    }
    this.db.save();
    return { ...this.localAp(ap, request), transferredDeviceCount, targetUser: this.localUser(targetUser) };
  }

  @Delete('aps/:apId')
  deleteAp(@Param('apId') apId: string, @Req() request: Request) {
    this.assertRowVisible(this.findAp(apId) as BaseStation & Row, request, 'AP not found');
    this.db.baseStations.delete(apId);
    for (const label of this.db.labels.values()) {
      const row = label as Label & Row;
      if (row.apId === apId) {
        delete row.apId;
      }
    }
    this.db.save();
    return { ok: true };
  }

  @Get('aps/:apId/heartbeats')
  apHeartbeats(@Param('apId') apId: string, @Req() request: Request) {
    const ap = this.assertRowVisible(this.findAp(apId) as BaseStation & Row, request, 'AP not found');
    return [{
      id: `${ap.id}-latest`,
      createdAt: ap.lastSeenAt ?? now(),
      status: ap.status,
      payloadJson: { ip: ap.ip, firmware: ap.firmware },
    }];
  }

  @Get('tasks')
  tasks(@Query() query: Row, @Req() request: Request) {
    const tasks = this.filterRowsByOwnerAndKeyword(
      this.visibleRows([...this.db.cloudTasks.values()], request).reverse(),
      query,
      ['id', 'taskType', 'status', 'resultMsg', 'eslDeviceId', 'apId', 'productId', 'templateId'],
    );
    const { page, pageSize, start, end } = paginationParams(query);
    return {
      items: tasks.slice(start, end).map((item) => this.localTaskListItem(item)),
      page,
      pageSize,
      total: tasks.length,
    };
  }

  @Get('tasks/:taskId')
  task(@Param('taskId') taskId: string, @Req() request: Request) {
    const task = this.assertRowVisible(this.db.cloudTasks.get(taskId) as Row | undefined, request, 'Task not found');
    return this.localTask(task, true);
  }

  @Post('tasks/:taskId/retry')
  async retryTask(@Param('taskId') taskId: string, @Req() request: Request) {
    const task = this.assertRowVisible(this.db.cloudTasks.get(taskId) as Row | undefined, request, 'Task not found');
    const status = stringValue(task.status).toLowerCase();
    if (['queued', 'rendering', 'sending', 'success'].includes(status)) {
      throw new BadRequestException('当前任务状态不允许手动重试');
    }

    const labelId = String(task.eslDeviceId ?? '');
    const label = this.findLabel(labelId);
    const apId = this.resolveDeliveryApId(label);
    if (!apId) {
      throw new BadRequestException('没有可用基站，无法手动重试');
    }

    const manualRetryCount = this.manualRetryCount(task) + 1;
    const payload = task.payload && typeof task.payload === 'object' ? task.payload as Row : {};
    task.retryCount = manualRetryCount;
    task.apId = apId;
    task.status = 'sending';
    task.resultMsg = `已提交第 ${manualRetryCount} 次手动重试，正在唤醒价签并重新下发。`;
    task.payload = {
      ...payload,
      retryInFlight: true,
      manualRetryInFlight: true,
      manualRetryCount,
      lastManualRetryAt: now(),
    };
    task.updatedAt = now();
    this.db.cloudTasks.set(taskId, task);
    this.db.save();

    void this.runManualRetryLoop(taskId, manualRetryCount).catch((error) => {
      const latest = this.db.cloudTasks.get(taskId);
      if (!latest) return;
      const latestPayload = latest.payload && typeof latest.payload === 'object' ? latest.payload as Row : {};
      latest.status = 'failed';
      latest.resultMsg = `手动重试失败：${error instanceof Error ? error.message : String(error)}`;
      latest.payload = { ...latestPayload, retryInFlight: false, manualRetryInFlight: false };
      latest.updatedAt = now();
      this.db.cloudTasks.set(taskId, latest);
      this.db.save();
    });

    return this.localTask(task, false);
  }

  @Delete('tasks/:taskId')
  deleteTask(@Param('taskId') taskId: string, @Req() request: Request) {
    this.assertRowVisible(this.db.cloudTasks.get(taskId) as Row | undefined, request, 'Task not found');
    this.db.cloudTasks.delete(taskId);
    this.db.save();
    return { deleted: true, id: taskId };
  }

  @Post('tasks/cleanup-stuck')
  cleanupStuckTasks(@Body() body: Row, @Req() request: Request) {
    this.requireAdminUser(request);
    const statuses = Array.isArray(body.statuses)
      ? new Set(body.statuses.map((item) => stringValue(item).toLowerCase()).filter(Boolean))
      : new Set(['queued', 'rendering', 'sending', 'trigger_pending', 'timeout']);
    let updatedCount = 0;
    for (const task of this.visibleRows([...this.db.cloudTasks.values()], request)) {
      const status = stringValue(task.status).toLowerCase();
      if (!statuses.has(status)) continue;
      this.clearDeferredRefreshTimer(String(task.id ?? ''));
      const payload = task.payload && typeof task.payload === 'object' ? task.payload as Row : {};
      task.status = stringValue(body.nextStatus, 'cancelled');
      task.payload = { ...payload, retryInFlight: false, cleanupReason: 'admin_cleanup_stuck_tasks' };
      task.resultMsg = stringValue(body.reason, '发布清理：旧批量刷新任务已取消，请重新触发刷新。');
      task.updatedAt = now();
      this.db.cloudTasks.set(String(task.id), task);
      updatedCount += 1;
    }
    if (updatedCount > 0) {
      this.db.save();
    }
    return { ok: true, updatedCount, statuses: [...statuses] };
  }

  // 手动立即清理过期任务（管理员），不必等待定时器。
  @Post('tasks/cleanup-expired')
  cleanupExpiredTasks(@Req() request: Request) {
    this.requireAdminUser(request);
    const removed = this.purgeExpiredTasks();
    return { ok: true, removed, retentionDays: Math.max(1, Number(process.env.ESL_TASK_RETENTION_DAYS ?? 3)) };
  }

  @Post('tasks/batch-refresh')
  async batchRefresh(@Body() body: Row, @Req() request: Request) {
    const visibleIds = new Set(this.localDevices(request).map((item) => String(item.id)));
    const ids = Array.isArray(body.deviceIds)
      ? body.deviceIds.map(String).filter((id) => visibleIds.has(id))
      : [...visibleIds];
    const tasks = await this.createRefreshTasksQueued(ids, 'batch_refresh');
    return { ok: true, createdTaskCount: tasks.length, taskIds: tasks.map((task) => String(task.id)) };
  }

  @Get('users')
  users(@Query() query: Row, @Req() request: Request) {
    const currentUser = this.requireAdminUser(request);
    const users = [...this.db.users.values()]
      .filter((user) => String(user.id ?? '') === String(currentUser.id ?? '') || !this.isAdminUser(user))
      .filter((user) => {
        const keyword = stringValue(query.keyword).toLowerCase();
        if (!keyword) return true;
        return [user.username, user.displayName, user.email, user.role]
          .map((item) => stringValue(item).toLowerCase())
          .join(' ')
          .includes(keyword);
      })
      .map((user) => this.localUser(user));
    return paginate(users, query);
  }

  @Get('users/invites')
  invites(@Query() query: Row, @Req() request: Request) {
    this.requireAdminUser(request);
    const invites = [...this.db.userInvites.values()]
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
      .map((invite) => this.localInvite(invite));
    return paginate(invites, query);
  }

  @Get('users/audit-logs')
  auditLogs(@Query() query: Row, @Req() request: Request) {
    this.requireAdminUser(request);
    return paginate(this.db.auditLogs, query);
  }

  @Get('users/:userId')
  userDetail(@Param('userId') userId: string, @Req() request: Request) {
    this.requireAdminUser(request);
    const user = this.findUser(userId);
    if (this.isAdminUser(user)) {
      throw new NotFoundException('User not found');
    }
    const stores = this.userOwnedRows([...this.db.stores.values()] as Array<StoreConfig & Row>, userId);
    const aps = this.userOwnedRows([...this.db.baseStations.values()] as Array<BaseStation & Row>, userId);
    const devices = this.userOwnedRows([...this.db.labels.values()] as Array<Label & Row>, userId);
    const products = this.userOwnedRows([...this.db.cloudProducts.values()], userId);
    const templates = this.userOwnedRows([...this.db.cloudTemplates.values()], userId);
    const tasks = this.userOwnedRows([...this.db.cloudTasks.values()], userId);

    return {
      user: this.localUser(user),
      counts: {
        stores: stores.length,
        aps: aps.length,
        devices: devices.length,
        products: products.length,
        templates: templates.length,
        tasks: tasks.length,
      },
      stores: stores.map((store) => this.localStoreForOwner(store, userId)),
      aps: aps.map((ap) => this.localApForOwner(ap, userId)),
      devices: devices.map((device) => this.localDeviceForOwner(device)),
      products,
      templates: templates.map((template) => ({
        ...this.localTemplate(template),
        useDeviceCount: devices.filter((device) => {
          if (String(device.templateId ?? '') === String(template.id ?? '')) return true;
          if (device.templateId) return false;
          const product = device.productId ? products.find((item) => String(item.id ?? '') === String(device.productId)) : undefined;
          return String(product?.defaultTemplateId ?? '') === String(template.id ?? '');
        }).length,
      })),
      tasks: tasks
        .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
        .slice(0, 100)
        .map((task) => this.localTask(task, false)),
    };
  }

  @Post('users/invites')
  createInvite(@Body() body: Row, @Req() request: Request) {
    this.requireAdminUser(request);
    const username = stringValue(body.username).trim();
    if (!username) throw new BadRequestException('Username is required');
    const storeCode = stringValue(body.storeCode) || [...this.db.stores.values()][0]?.code || '';
    if (storeCode && !this.db.stores.has(storeCode)) {
      throw new NotFoundException('Store not found');
    }
    if (this.findLoginUser(undefined, username, false)) {
      throw new BadRequestException('Username already exists');
    }
    const existingInvite = [...this.db.userInvites.values()].find((invite) => (
      String(invite.storeCode ?? '') === storeCode
      && String(invite.username ?? '') === username
      && !invite.usedAt
      && !invite.revokedAt
      && new Date(String(invite.expiresAt ?? '')).getTime() > Date.now()
    ));
    if (existingInvite) {
      return this.localInvite(existingInvite);
    }
    const timestamp = now();
    const expiresInDays = Math.max(1, Math.min(30, numberValue(body.expiresInDays, 7)));
    const invite = {
      id: id('invite'),
      token: randomUUID().replace(/-/g, ''),
      storeCode: storeCode || undefined,
      username,
      displayName: stringValue(body.displayName) || undefined,
      email: stringValue(body.email) || undefined,
      role: normalizeRole(body.role, 'OPERATOR'),
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
      createdByUserId: this.ensureAdminUser().id,
      createdAt: timestamp,
      updatedAt: timestamp,
      usedAt: null,
      revokedAt: null,
    };
    this.db.userInvites.set(invite.id, invite);
    this.addAuditLog('users', 'create_invite', invite.id, null, this.localInvite(invite));
    this.db.save();
    return this.localInvite(invite);
  }

  @Post('users/:userId/disable')
  disableUser(@Param('userId') userId: string, @Req() request: Request) {
    this.requireAdminUser(request);
    const user = this.findUser(userId);
    if (normalizeRole(user.role) === 'ADMIN') {
      throw new BadRequestException('Admin user cannot be disabled');
    }
    const before = this.localUser(user);
    user.status = 'disabled';
    user.updatedAt = now();
    this.db.users.set(userId, user);
    this.addAuditLog('users', 'disable', userId, before, this.localUser(user));
    this.db.save();
    return this.localUser(user);
  }

  @Post('users/:userId/enable')
  enableUser(@Param('userId') userId: string, @Req() request: Request) {
    this.requireAdminUser(request);
    const user = this.findUser(userId);
    const before = this.localUser(user);
    user.status = 'active';
    user.updatedAt = now();
    this.db.users.set(userId, user);
    this.addAuditLog('users', 'enable', userId, before, this.localUser(user));
    this.db.save();
    return this.localUser(user);
  }

  @Post('users/:userId/reset-password')
  resetPassword(@Param('userId') userId: string, @Body() body: Row, @Req() request: Request) {
    this.requireAdminUser(request);
    const password = String(body.password ?? '');
    if (password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    const user = this.findUser(userId);
    const before = this.localUser(user);
    user.passwordHash = bcrypt.hashSync(password, 10);
    user.updatedAt = now();
    this.db.users.set(userId, user);
    this.addAuditLog('users', 'reset_password', userId, before, this.localUser(user));
    this.db.save();
    return this.localUser(user);
  }

  @Post('users/invites/:inviteId/revoke')
  revokeInvite(@Param('inviteId') inviteId: string, @Req() request: Request) {
    this.requireAdminUser(request);
    const invite = this.db.userInvites.get(inviteId);
    if (!invite) throw new NotFoundException('Invite not found');
    if (!invite.usedAt && !invite.revokedAt) {
      invite.revokedAt = now();
      invite.updatedAt = now();
      this.db.userInvites.set(inviteId, invite);
      this.addAuditLog('users', 'revoke_invite', inviteId, null, this.localInvite(invite));
      this.db.save();
    }
    return this.localInvite(invite);
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

    await fs.mkdir(getUploadDir(), { recursive: true });
    const ext = imageExtension(file.mimetype, file.originalname);
    const filename = `${Date.now()}-${randomUUID()}${ext}`;
    await fs.writeFile(join(getUploadDir(), filename), file.buffer);

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
      const body = await fs.readFile(join(getUploadDir(), filename));
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
      status: normalizeProductStatus(input.status),
      ownerUserId: input.ownerUserId,
      storeCode: input.storeCode,
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
      colorMode: this.normalizeTemplateColorMode(input.colorMode),
      status: input.status ?? 'draft',
      version: numberValue(input.version, 1),
      previewImageUrl: stringValue(input.previewImageUrl, this.templatePreviewUrl(templateId)),
      schema: input.schema ?? defaultSchema(input),
      recentVersions: input.recentVersions ?? [],
      ownerUserId: input.ownerUserId,
      storeCode: input.storeCode,
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

  private localTemplate(template: Row, request?: Request): Row {
    const normalized = this.ensureTemplatePreview(template);
    const templateId = String(normalized.id ?? '');
    const useDeviceCount = [...this.db.labels.values()].filter((label) => {
      const row = label as Label & Row;
      if (!this.canAccessRow(row, request)) return false;
      if (String(row.templateId ?? '') === templateId) return true;
      if (row.templateId) return false;
      const product = row.productId
        ? this.visibleRows([...this.db.cloudProducts.values()], request).find((item) => item.id === row.productId)
        : undefined;
      return String(product?.defaultTemplateId ?? '') === templateId;
    }).length;

    return {
      ...normalized,
      owner: this.ownerSummary(normalized.ownerUserId),
      useDeviceCount,
    };
  }

  private buildRefreshTask(deviceId: string, taskType: string, parentTaskId?: string) {
    const label = this.findLabel(deviceId);
    const apId = this.resolveDeliveryApId(label);
    const timestamp = now();
    const taskId = id('task');
    if (!parentTaskId) {
      this.supersedePendingRefreshTasks(label.id, taskId);
    }
    const task = {
      id: taskId,
      taskType,
      eslDeviceId: deviceId,
      apId,
      productId: (label as Label & Row).productId,
      templateId: (label as Label & Row).templateId,
      ownerUserId: (label as Label & Row).ownerUserId,
      owner: this.ownerSummary((label as Label & Row).ownerUserId),
      storeCode: label.storeCode,
      payload: { labelId: label.id, localRenderer: true, refreshGeneration: taskId },
      renderResult: {},
      retryCount: 0,
      status: 'queued',
      parentTaskId,
      triggeredAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      eslDevice: {
        id: label.id,
        eslCode: label.id,
        name: label.title,
        apId: label.apId,
        productId: (label as Label & Row).productId,
        templateId: (label as Label & Row).templateId,
        status: label.status,
      },
    } as Row;
    const template = this.resolveEffectiveTemplateForLabel(label as Label & Row);
    if (this.normalizeTemplateColorMode(template?.colorMode) === 'bw') {
      task.payload = {
        ...(task.payload as Row),
        colorMode: 'bw',
        requireWriteSvcAck: true,
      };
    }
    return task;
  }

  private async createRefreshTask(deviceId: string, taskType: string, parentTaskId?: string) {
    const task = this.buildRefreshTask(deviceId, taskType, parentTaskId);
    this.db.cloudTasks.set(String(task.id), task);
    this.db.save();
    await this.enqueueRefreshTask(stringValue(task.apId) || undefined, String(task.id));
    return task;
  }

  private async createRefreshTasksQueued(deviceIds: string[], taskType: string) {
    const tasks: Row[] = [];
    for (const deviceId of [...new Set(deviceIds)]) {
      const task = this.buildRefreshTask(deviceId, taskType);
      this.db.cloudTasks.set(String(task.id), task);
      tasks.push(task);
    }
    this.db.save();
    void this.enqueueRefreshTasksInBackground(tasks).catch((error) => {
      this.db.recordRequest({
        method: 'REFRESH-TASK-ENQUEUE',
        path: '/tasks/enqueue',
        statusCode: 500,
        body: { taskType, count: tasks.length, error: error instanceof Error ? error.message : String(error) },
      });
    });
    return tasks;
  }

  private createRefreshTasksQueuedFast(deviceIds: string[], taskType: string) {
    const uniqueIds = [...new Set(deviceIds)];
    const batchSize = Math.max(1, Math.min(25, Number(process.env.ESL_TASK_CREATE_BACKGROUND_BATCH_SIZE ?? 10)));
    const batchDelayMs = Math.max(25, Math.min(2000, Number(process.env.ESL_TASK_CREATE_BACKGROUND_DELAY_MS ?? 150)));

    setTimeout(() => void (async () => {
      const tasks: Row[] = [];
      for (let index = 0; index < uniqueIds.length; index += batchSize) {
        const batch = uniqueIds.slice(index, index + batchSize);
        for (const deviceId of batch) {
          const task = this.buildRefreshTask(deviceId, taskType);
          this.db.cloudTasks.set(String(task.id), task);
          tasks.push(task);
        }
        this.db.saveDeferred();
        void this.enqueueRefreshTasksInBackground(tasks.splice(0)).catch((error) => {
          this.db.recordRequest({
            method: 'REFRESH-TASK-ENQUEUE',
            path: '/tasks/enqueue',
            statusCode: 500,
            body: { taskType, count: batch.length, error: error instanceof Error ? error.message : String(error) },
          });
        });
        if (index + batchSize < uniqueIds.length) {
          await wait(batchDelayMs);
        }
      }
    })().catch((error) => {
      this.db.recordRequest({
        method: 'REFRESH-TASK-BACKGROUND',
        path: '/tasks/background-create',
        statusCode: 500,
        body: { taskType, count: uniqueIds.length, error: error instanceof Error ? error.message : String(error) },
      });
    }), 0);

    return uniqueIds.map((deviceId) => `${taskType}:pending:${deviceId}`);
  }

  private async enqueueRefreshTasksInBackground(tasks: Row[]) {
    const batchSize = Math.max(1, Math.min(20, Number(process.env.ESL_TASK_ENQUEUE_BATCH_SIZE ?? 10)));
    for (let index = 0; index < tasks.length; index += batchSize) {
      const batch = tasks
        .slice(index, index + batchSize)
        .filter((task) => this.isTaskStillCurrentBeforeQueue(task));
      await Promise.all(batch.map((task) => this.enqueueRefreshTask(stringValue(task.apId) || undefined, String(task.id))));
      if (index + batchSize < tasks.length) {
        await wait(100);
      }
    }
  }

  private supersedePendingRefreshTasks(labelId: string, nextTaskId?: string) {
    const supersedableStatuses = new Set(['queued', 'trigger_pending', 'rendering', 'timeout']);
    for (const task of this.db.cloudTasks.values()) {
      if (
        String(task.eslDeviceId ?? '') === labelId
        && supersedableStatuses.has(String(task.status ?? ''))
        && !task.parentTaskId
        && String(task.id ?? '') !== nextTaskId
      ) {
        this.clearDeferredRefreshTimer(String(task.id ?? ''));
        const payload = task.payload && typeof task.payload === 'object' ? task.payload as Row : {};
        task.status = 'superseded';
        task.payload = { ...payload, supersededByTaskId: nextTaskId };
        task.resultMsg = '同一标签已有新的刷新任务，旧的未执行任务已自动由最后一次刷新覆盖';
        task.updatedAt = now();
      }
    }
  }

  private isTaskStillCurrentBeforeQueue(task: Row) {
    const latest = this.db.cloudTasks.get(String(task.id ?? ''));
    if (!latest || ['superseded', 'cancelled', 'skipped', 'success'].includes(String(latest.status ?? ''))) {
      return false;
    }
    return !this.supersedeIfStaleRefreshTask(latest);
  }

  private supersedeIfStaleRefreshTask(task: Row) {
    if (task.parentTaskId) return false;
    const taskId = String(task.id ?? '');
    const labelId = String(task.eslDeviceId ?? '');
    if (!taskId || !labelId) return false;

    const activeNewerStatuses = new Set(['queued', 'trigger_pending', 'rendering', 'sending', 'timeout']);
    const taskTime = new Date(String(task.createdAt ?? task.triggeredAt ?? '')).getTime();
    const hasNewer = [...this.db.cloudTasks.values()].some((candidate) => {
      if (String(candidate.id ?? '') === taskId) return false;
      if (String(candidate.eslDeviceId ?? '') !== labelId) return false;
      if (candidate.parentTaskId) return false;
      if (!activeNewerStatuses.has(String(candidate.status ?? ''))) return false;
      const candidateTime = new Date(String(candidate.createdAt ?? candidate.triggeredAt ?? '')).getTime();
      if (Number.isFinite(taskTime) && Number.isFinite(candidateTime) && candidateTime <= taskTime) return false;
      return Number.isFinite(candidateTime) || String(candidate.id ?? '') > taskId;
    });
    if (!hasNewer) return false;

    this.clearDeferredRefreshTimer(taskId);
    const payload = task.payload && typeof task.payload === 'object' ? task.payload as Row : {};
    task.status = 'superseded';
    task.payload = { ...payload, supersededByNewerRefresh: true };
    task.resultMsg = '同一标签已有更新的刷新任务，本次旧任务已自动跳过';
    task.updatedAt = now();
    this.db.cloudTasks.set(taskId, task);
    this.db.saveDeferred();
    return true;
  }

  private async enqueueRefreshTask(apId: string | undefined, taskId: string) {
    const pendingTask = this.db.cloudTasks.get(taskId);
    if (pendingTask && this.supersedeIfStaleRefreshTask(pendingTask)) return;
    if (!apId) {
      const task = this.db.cloudTasks.get(taskId);
      if (task) {
        task.status = 'failed';
        task.resultMsg = '没有可用基站，刷新任务无法加入下发队列';
        task.updatedAt = now();
        this.db.cloudTasks.set(taskId, task);
        this.db.save();
      }
      return;
    }

    await this.refreshQueue.add({ apId, taskId });
  }

  private async executeQueuedRefreshTask(taskId: string) {
    const task = this.db.cloudTasks.get(taskId);
    if (!task || !['queued', 'trigger_pending'].includes(String(task.status ?? ''))) return { holdSlot: false };
    if (this.supersedeIfStaleRefreshTask(task)) return { holdSlot: false };
    this.clearDeferredRefreshTimer(taskId);
    if (task.parentTaskId) {
      const parent = this.db.cloudTasks.get(String(task.parentTaskId));
      if (parent && String(parent.status ?? '') === 'success') {
        task.status = 'skipped';
        task.resultMsg = '父任务已确认执行成功，自动补发任务已取消';
        task.updatedAt = now();
        this.db.cloudTasks.set(taskId, task);
        this.db.save();
        return { holdSlot: false };
      }
    }

    const payload = task.payload && typeof task.payload === 'object' ? task.payload as Row : {};
    const deferredAttempts = numberValue(payload.deferredRetryAttempts, 0);
    if (String(task.status ?? '') === 'trigger_pending' && deferredAttempts >= REFRESH_DEFERRED_RETRY_MAX) {
      task.status = 'failed';
      task.resultMsg = `刷新失败：待触发期间已间隔重试 ${REFRESH_DEFERRED_RETRY_MAX} 次，仍未收到价签确认。请确认标签在基站范围内且在线后手动重试。`;
      task.payload = { ...payload, retryInFlight: false, deferredRetryExhausted: true };
      task.updatedAt = now();
      this.db.cloudTasks.set(taskId, task);
      this.db.saveDeferred();
      return { holdSlot: false };
    }

    const labelId = String(task.eslDeviceId ?? '');
    const label = this.findLabel(labelId);
    try {
      const wake = await this.ensureLabelReadyForRefresh(task, label);
      if (!wake.ok) return { holdSlot: false };

      const latestBeforeRender = this.db.cloudTasks.get(taskId);
      if (!latestBeforeRender || String(latestBeforeRender.status ?? '') !== 'queued') return { holdSlot: false };
      if (this.supersedeIfStaleRefreshTask(latestBeforeRender)) return { holdSlot: false };

      latestBeforeRender.status = 'rendering';
      latestBeforeRender.resultMsg = '任务已进入 AP 下发队列，正在生成刷新图片';
      latestBeforeRender.updatedAt = now();
      this.db.cloudTasks.set(taskId, latestBeforeRender);
      this.db.saveDeferred();

      const render = await this.renderTemplateForLabel(label);
      const latestBeforeDelivery = this.db.cloudTasks.get(taskId);
      if (!latestBeforeDelivery || String(latestBeforeDelivery.status ?? '') !== 'rendering') return { holdSlot: false };
      if (this.supersedeIfStaleRefreshTask(latestBeforeDelivery)) return { holdSlot: false };
      latestBeforeDelivery.renderResult = {
        width: render.width,
        height: render.height,
        colorMode: render.colorMode,
        previewImageUrl: render.previewImageUrl,
      };
      const delivery = await this.deliverRefreshTask(label, render, latestBeforeDelivery.id);
      if (delivery.apId) {
        latestBeforeDelivery.apId = delivery.apId;
      }
      latestBeforeDelivery.status = delivery.ok ? 'sending' : 'failed';
      latestBeforeDelivery.resultMsg = delivery.reason;
      latestBeforeDelivery.delivery = delivery;
      latestBeforeDelivery.updatedAt = now();
      if (delivery.commandId) {
        latestBeforeDelivery.payload = { ...(latestBeforeDelivery.payload as Row), commandId: delivery.commandId };
      }
      this.db.cloudTasks.set(taskId, latestBeforeDelivery);
      this.db.saveDeferred();
      this.scheduleDeferredRefreshRetry(label.id, taskId);
    } catch (error) {
      task.status = 'failed';
      task.resultMsg = `刷新任务执行失败：${error instanceof Error ? error.message : String(error)}`;
      task.updatedAt = now();
      this.db.cloudTasks.set(taskId, task);
      this.db.saveDeferred();
    }
  }

  private async ensureLabelReadyForRefresh(task: Row, label: Label) {
    const labelStatus = this.effectiveLabelStatus(label);
    const payload = task.payload && typeof task.payload === 'object' ? task.payload as Row : {};
    const apId = this.resolveDeliveryApId(label);
    if (apId && String(task.apId ?? '') !== apId) {
      task.apId = apId;
      this.db.cloudTasks.set(String(task.id), task);
    }
    const alreadyVerified = this.hasRecentVerifiedLabelContact(label, LABEL_ONLINE_STABLE_MS, apId);
    if (labelStatus === 'online' && alreadyVerified && payload.preflightWakeRequired !== true) {
      return { ok: true, alreadyOnline: true };
    }

    const maxAttempts = Math.max(1, Math.min(3, Number(process.env.ESL_REFRESH_OFFLINE_WAKE_ATTEMPTS ?? 3)));
    if (!apId) {
      task.status = 'failed';
      task.resultMsg = '刷新失败：没有可用基站。请确认基站在线后重试。';
      task.payload = { ...payload, preflightWakeRequired: true, preflightWakeAttempts: 0 };
      task.updatedAt = now();
      this.db.cloudTasks.set(String(task.id), task);
      this.db.saveDeferred();
      return { ok: false };
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      task.status = 'trigger_pending';
      task.apId = apId;
      task.resultMsg = `标签当前未确认在线，正在第 ${attempt}/${maxAttempts} 次尝试唤醒连接。`;
      task.payload = {
        ...payload,
        preflightWakeRequired: true,
        preflightWakeAttempts: attempt,
        lastPreflightWakeAt: now(),
      };
      task.updatedAt = now();
      this.db.cloudTasks.set(String(task.id), task);
      this.db.saveDeferred();

      const wake = await this.runSilentWake([label.id], {
        apId,
        waitMs: Math.max(4000, Math.min(20000, Number(process.env.ESL_REFRESH_OFFLINE_WAKE_WAIT_MS ?? 7000))),
        psmDurationMs: Math.max(5000, Math.min(60000, Number(process.env.ESL_REFRESH_OFFLINE_WAKE_PSM_MS ?? 15000))),
        sendMqtt: true,
        sendWs: true,
        disconnectAfterProbe: true,
      });
      const labelWake = Array.isArray(wake.labels) ? wake.labels.find((item) => item.labelId === label.id) : undefined;
      if (wake.ok || labelWake?.state === 'online') {
        task.status = 'queued';
        task.resultMsg = `标签已唤醒连接成功，准备下发刷新。`;
        task.payload = {
          ...(task.payload && typeof task.payload === 'object' ? task.payload as Row : {}),
          preflightWakeRequired: false,
          preflightWakeSucceededAt: now(),
        };
        task.updatedAt = now();
        this.db.cloudTasks.set(String(task.id), task);
        this.db.saveDeferred();
        return { ok: true };
      }

      if (attempt < maxAttempts) {
        await wait(Math.max(500, Math.min(5000, Number(process.env.ESL_REFRESH_OFFLINE_WAKE_RETRY_DELAY_MS ?? 1200))));
      }
    }

    task.status = 'trigger_pending';
    task.resultMsg = `刷新前暂未收到标签真实回包，已进入待触发；系统会每 ${Math.round(REFRESH_DEFERRED_RETRY_DELAY_MS / 1000)} 秒重新尝试下发，最多 ${REFRESH_DEFERRED_RETRY_MAX} 次。`;
    task.payload = {
      ...(task.payload && typeof task.payload === 'object' ? task.payload as Row : {}),
      preflightWakeRequired: true,
      preflightWakePendingAt: now(),
    };
    task.updatedAt = now();
    this.db.cloudTasks.set(String(task.id), task);
    this.db.saveDeferred();
    this.scheduleDeferredRefreshRetry(label.id, String(task.id));
    return { ok: false };
  }

  private async recoverQueuedRefreshTasks() {
    const recoverableStatuses = new Set(['queued', 'rendering', 'sending', 'timeout', 'trigger_pending']);
    const tasks = [...this.db.cloudTasks.values()]
      .filter((task) => recoverableStatuses.has(String(task.status ?? '')))
      .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));

    for (const task of tasks) {
      const taskId = String(task.id ?? '');
      const labelId = String(task.eslDeviceId ?? '');
      const label = labelId ? this.db.labels.get(labelId) : undefined;
      if (!taskId || !label) {
        task.status = 'failed';
        task.resultMsg = '服务重启恢复任务失败：标签不存在';
        task.updatedAt = now();
        continue;
      }

      const payload = task.payload && typeof task.payload === 'object' ? task.payload as Row : {};
      if (this.taskHasSuccessfulRefreshEvent(task)) {
        task.status = 'success';
        task.resultMsg = '刷新成功，基站已完成本次下发。';
        task.payload = { ...payload, retryInFlight: false };
        task.updatedAt = now();
        this.db.cloudTasks.set(taskId, task);
        continue;
      }

      if (payload.autoRetryExhausted === true || payload.deferredRetryExhausted === true) {
        task.status = 'failed';
        task.resultMsg = payload.deferredRetryExhausted === true
          ? `刷新失败：待触发期间已重试 ${numberValue(payload.deferredRetryAttempts, REFRESH_DEFERRED_RETRY_MAX)} 次，仍未收到价签确认。`
          : '刷新失败：已多次自动唤醒并重试，仍未收到价签确认。';
        task.payload = { ...payload, retryInFlight: false };
        task.updatedAt = now();
        this.db.cloudTasks.set(taskId, task);
        continue;
      }

      if (String(task.status ?? '') === 'trigger_pending') {
        task.resultMsg = '服务重启后已恢复待触发刷新，稍后继续尝试下发';
        task.updatedAt = now();
        task.payload = { ...payload, retryInFlight: false };
        this.db.cloudTasks.set(taskId, task);
        this.scheduleDeferredRefreshRetry(label.id, taskId, 2_000);
        continue;
      }

      task.status = 'queued';
      task.resultMsg = '服务重启后已恢复到刷新队列';
      task.updatedAt = now();
      if (payload.retryInFlight === true) {
        task.payload = { ...payload, retryInFlight: false };
      }
      task.apId = this.resolveDeliveryApId(label);
      this.db.cloudTasks.set(taskId, task);
      await this.enqueueRefreshTask(String(task.apId || ''), taskId);
    }

    if (tasks.length > 0) {
      this.db.save();
    }
  }

  private startQueuedTaskReconciler() {
    const enabled = readBool(process.env.ESL_REFRESH_QUEUE_RECONCILER_ENABLED, true);
    if (!enabled) return;
    const intervalMs = Math.max(10_000, Math.min(300_000, Number(process.env.ESL_REFRESH_QUEUE_RECONCILE_INTERVAL_MS ?? 30_000)));
    setInterval(() => {
      void this.reconcileQueuedRefreshTasks().catch((error) => {
        this.db.recordRequest({
          method: 'REFRESH-TASK-RECONCILE',
          path: '/tasks/reconcile',
          statusCode: 500,
          body: { error: error instanceof Error ? error.message : String(error) },
        });
      });
    }, intervalMs);
  }

  private async reconcileQueuedRefreshTasks() {
    const staleAfterMs = Math.max(30_000, Math.min(3_600_000, Number(process.env.ESL_REFRESH_QUEUE_STALE_MS ?? 120_000)));
    const limit = Math.max(1, Math.min(100, Number(process.env.ESL_REFRESH_QUEUE_RECONCILE_LIMIT ?? 50)));
    const staleTasks = [...this.db.cloudTasks.values()]
      .filter((task) => {
        const status = String(task.status ?? '');
        if (!['queued', 'trigger_pending'].includes(status)) return false;
        if (task.parentTaskId) return false;
        return !isWithinMs(task.updatedAt ?? task.createdAt, staleAfterMs);
      })
      .sort((a, b) => String(a.updatedAt ?? a.createdAt ?? '').localeCompare(String(b.updatedAt ?? b.createdAt ?? '')))
      .slice(0, limit);

    let requeuedCount = 0;
    for (const task of staleTasks) {
      if (this.supersedeIfStaleRefreshTask(task)) continue;
      const taskId = String(task.id ?? '');
      if (!taskId || await this.refreshQueue.hasTask(taskId)) continue;
      const labelId = String(task.eslDeviceId ?? '');
      const label = labelId ? this.db.labels.get(labelId) : undefined;
      if (!label) {
        task.status = 'failed';
        task.resultMsg = '队列恢复失败：标签不存在';
        task.updatedAt = now();
        this.db.cloudTasks.set(taskId, task);
        continue;
      }
      const apId = this.resolveDeliveryApId(label);
      if (!apId) {
        task.status = 'trigger_pending';
        task.resultMsg = '暂无可用基站，任务保持待触发。';
        task.updatedAt = now();
        this.db.cloudTasks.set(taskId, task);
        continue;
      }
      task.status = 'queued';
      task.apId = apId;
      task.resultMsg = '检测到任务排队状态丢失，已重新加入刷新队列。';
      task.updatedAt = now();
      this.db.cloudTasks.set(taskId, task);
      await this.enqueueRefreshTask(apId, taskId);
      requeuedCount += 1;
    }

    if (staleTasks.length > 0) {
      this.db.saveDeferred();
      this.db.recordRequest({
        method: 'REFRESH-TASK-RECONCILE',
        path: '/tasks/reconcile',
        statusCode: 200,
        body: { checkedCount: staleTasks.length, requeuedCount },
      });
    }
  }

  private taskHasSuccessfulRefreshEvent(task: Row) {
    const events = Array.isArray(task.events) ? task.events as Row[] : [];
    return events.some((event) => {
      const message = String(event.message ?? event.userMessage ?? '');
      const technical = event.trace && typeof event.trace === 'object'
        ? (event.trace as Row).technical as Row | undefined
        : undefined;
      return message.includes('刷新成功')
        || (
          String(technical?.replyType ?? '') === 'READ_WRITE_SVC'
          && String(technical?.cmdType ?? '') === 'DIS_CONN'
          && Number(technical?.errno) === 0
          && Number(technical?.tasksCount) === 0
        );
    });
  }

  private manualRetryCount(task: Row) {
    const payload = task.payload && typeof task.payload === 'object' ? task.payload as Row : {};
    if (payload.manualRetryCount !== undefined) {
      return numberValue(payload.manualRetryCount, 0);
    }
    if (payload.lastAutoRetryAt || payload.autoRetryAttempts !== undefined || payload.autoRetryExhausted === true) {
      return 0;
    }
    return numberValue(task.retryCount, 0);
  }

  private async runManualRetryLoop(taskId: string, manualRetryCount: number) {
    const maxAttempts = Math.max(1, Math.min(3, Number(process.env.ESL_REFRESH_MANUAL_RETRY_ATTEMPTS ?? 3)));
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const task = this.db.cloudTasks.get(taskId);
      if (!task || String(task.status ?? '') === 'success') return;

      const labelId = String(task.eslDeviceId ?? '');
      const label = this.findLabel(labelId);
      const apId = this.resolveDeliveryApId(label);
      if (!apId) {
        task.status = 'failed';
        task.resultMsg = '手动重试失败：没有可用基站。';
        task.updatedAt = now();
        this.db.cloudTasks.set(taskId, task);
        this.db.save();
        return;
      }

      const payload = task.payload && typeof task.payload === 'object' ? task.payload as Row : {};
      task.status = 'sending';
      task.apId = apId;
      task.resultMsg = `第 ${manualRetryCount} 次手动重试：第 ${attempt}/${maxAttempts} 轮唤醒并刷新中。`;
      task.payload = {
        ...payload,
        retryInFlight: true,
        manualRetryInFlight: true,
        manualRetryCount,
        manualRetryAttempt: attempt,
        lastManualRetryAt: now(),
      };
      task.updatedAt = now();
      this.db.cloudTasks.set(taskId, task);
      this.db.save();

      await this.runSilentWake([labelId], {
        apId,
        waitMs: Math.max(3000, Math.min(12000, Number(process.env.ESL_REFRESH_RETRY_WAKE_WAIT_MS ?? 4500))),
        psmDurationMs: Math.max(3000, Math.min(30000, Number(process.env.ESL_REFRESH_RETRY_PSM_DURATION_MS ?? 12000))),
        sendMqtt: true,
        sendWs: true,
        disconnectAfterProbe: true,
      });

      const latest = this.db.cloudTasks.get(taskId);
      if (!latest || String(latest.status ?? '') === 'success') return;

      const render = await this.renderTemplateForLabel(label);
      const delivery = await this.deliverRefreshTask(label, render, latest.id);
      latest.renderResult = {
        width: render.width,
        height: render.height,
        colorMode: render.colorMode,
        previewImageUrl: render.previewImageUrl,
      };
      latest.status = delivery.ok ? 'sending' : 'failed';
      latest.resultMsg = delivery.ok
        ? `第 ${manualRetryCount} 次手动重试已完成第 ${attempt}/${maxAttempts} 轮下发，正在等待价签确认。`
        : delivery.reason;
      latest.delivery = {
        ...(delivery as Row),
        manualRetryCount,
        manualRetryAttempt: attempt,
      };
      const latestPayload = latest.payload && typeof latest.payload === 'object' ? latest.payload as Row : {};
      latest.payload = {
        ...latestPayload,
        retryInFlight: false,
        manualRetryInFlight: attempt < maxAttempts,
        manualRetryCount,
        manualRetryAttempt: attempt,
        lastManualRetryAt: now(),
      };
      if (delivery.commandId) {
        latest.payload = { ...(latest.payload as Row), commandId: delivery.commandId };
      }
      latest.updatedAt = now();
      this.db.cloudTasks.set(taskId, latest);
      this.db.save();

      await wait(Math.max(1000, Math.min(8000, Number(process.env.ESL_REFRESH_MANUAL_RETRY_ROUND_DELAY_MS ?? 2500))));
      const afterWait = this.db.cloudTasks.get(taskId);
      if (!afterWait || String(afterWait.status ?? '') === 'success') return;
    }

    const task = this.db.cloudTasks.get(taskId);
    if (!task || String(task.status ?? '') === 'success') return;
    const payload = task.payload && typeof task.payload === 'object' ? task.payload as Row : {};
    task.status = 'failed';
    task.resultMsg = `第 ${manualRetryCount} 次手动重试已完成 3 轮唤醒刷新，仍未收到价签确认。`;
    task.payload = { ...payload, retryInFlight: false, manualRetryInFlight: false };
    task.updatedAt = now();
    this.db.cloudTasks.set(taskId, task);
    this.db.save();
  }

  private resolveEffectiveTemplateForLabel(label: Label & Row, request?: Request) {
    const product = label.productId
      ? this.visibleRows([...this.db.cloudProducts.values()], request).find((item) => item.id === label.productId) ?? null
      : null;
    const templateId = stringValue(label.templateId, stringValue(product?.defaultTemplateId));
    return templateId
      ? this.visibleRows([...this.db.cloudTemplates.values()], request).find((item) => item.id === templateId) ?? null
      : null;
  }

  private isRefreshableTemplate(template: Row | null | undefined) {
    return Boolean(template && stringValue(template.status, 'draft') === 'published');
  }

  private refreshLinkedProductDevices(productId: string, taskType: string, request?: Request) {
    const labels = [...this.db.labels.values()]
      .map((label) => label as Label & Row)
      .filter((label) => String(label.productId ?? '') === productId && this.canAccessRow(label, request));
    const refreshableLabels = labels.filter((label) => this.isRefreshableTemplate(this.resolveEffectiveTemplateForLabel(label, request)));
    const taskIds = this.createRefreshTasksQueuedFast(refreshableLabels.map((label) => label.id), taskType);
    const missingTemplateCount = labels.length - refreshableLabels.length;
    return {
      attempted: true,
      boundDeviceCount: labels.length,
      refreshableDeviceCount: refreshableLabels.length,
      skippedDeviceCount: missingTemplateCount,
      createdTaskCount: taskIds.length,
      taskIds,
      reasonCode: labels.length ? (refreshableLabels.length ? null : 'no_template') : 'no_bound_devices',
      message: taskIds.length
        ? `商品已更新，已提交 ${taskIds.length} 个标签刷新任务，后台正在分批处理`
        : labels.length
          ? '商品已更新，但绑定标签没有已发布模板，未自动下发'
          : '商品已更新，但没有绑定标签，未自动下发',
    };
  }

  private refreshTemplateLinkedDevices(templateId: string, taskType: string, request?: Request) {
    const labels = [...this.db.labels.values()]
      .map((label) => label as Label & Row)
      .filter((label) => String(label.templateId ?? '') === templateId && this.canAccessRow(label, request));
    const taskIds = this.createRefreshTasksQueuedFast(labels.map((label) => label.id), taskType);
    return {
      attempted: true,
      boundDeviceCount: labels.length,
      refreshableDeviceCount: labels.length,
      skippedDeviceCount: 0,
      createdTaskCount: taskIds.length,
      taskIds,
      reasonCode: labels.length ? null : 'no_bound_devices',
      message: taskIds.length
        ? `模板已发布，已创建 ${taskIds.length} 个标签刷新任务，后台正在分批下发`
        : '模板已发布，但没有绑定标签，未自动下发',
    };
  }

  private countTemplateLinkedLabels(templateId: string, request?: Request) {
    return [...this.db.labels.values()]
      .map((label) => label as Label & Row)
      .filter((label) => String(label.templateId ?? '') === templateId && this.canAccessRow(label, request))
      .length;
  }

  private async deliverRefreshTask(label: Label, render: RenderedTemplateImage, taskId: unknown) {
    const apId = this.resolveDeliveryApId(label);
    if (!apId) {
      return { ok: false, reason: '没有在线基站，刷新任务无法下发' };
    }

    const packet = await this.buildLocalReadWritePacket(label.storeCode, apId, label.id, render);
    const preflight = await this.prepareRefreshWindow(label.storeCode, apId);
    const command = this.db.createCommand({
      storeCode: label.storeCode,
      targetType: 'label',
      targetId: label.id,
      type: 'refresh_label',
      payload: {
        source: 'api/v1',
        taskId,
        render: { width: render.width, height: render.height },
        colorMode: this.normalizeTemplateColorMode(render.colorMode),
        localProtocol: packet.renderMode,
        preflight,
      },
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
        clearBeforeWrite: packet.clearBeforeWrite,
        fit: packet.fit,
        resample: packet.resample,
        dither: packet.dither,
        preflight,
      },
    });

    const mqttOk = mqttResults.some((item) => item.ok);
    command.status = wsResult.ok || mqttOk ? 'sent' : 'failed';
    command.sentAt = new Date().toISOString();
    command.payload = { ...command.payload, mqttResults, preflight };
    this.db.commands.set(command.id, command);

    return {
      ok: wsResult.ok || mqttOk,
      reason: wsResult.ok
        ? `已打开快速监听窗口并下发（待执行确认），tracking=${wsResult.trackingId}，参数：${packet.renderMode} / ${packet.resample} / clear=${packet.clearBeforeWrite} / dither=${packet.dither}`
        : mqttOk
          ? `刷新任务已提交到本地 MQTT，并已尝试打开快速监听窗口；当前没有可用 WebSocket 连接。参数：${packet.renderMode} / ${packet.resample} / clear=${packet.clearBeforeWrite} / dither=${packet.dither}`
          : `刷新任务下发失败：WebSocket 不可用，MQTT 发布失败（${mqttResults.find((item) => !item.ok)?.reason ?? 'unknown'}）。`,
      commandId: command.id,
      transport: wsResult.ok ? 'websocket-read-write-svc+mqtt' : mqttOk ? 'mqtt' : 'none',
      websocket: wsResult,
      mqtt: mqttResults,
      preflight,
      protocol: {
        topic: packet.topic,
        payloadBytes: packet.payloadBytes,
        imageBytes: packet.imageBytes,
        imageFormat: packet.imageFormat,
        renderMode: packet.renderMode,
        clearBeforeWrite: packet.clearBeforeWrite,
      },
      apId,
    };
  }

  private async prepareRefreshWindow(storeCode: string, apId: string) {
    const enabled = readBool(process.env.ESL_REFRESH_PRE_WAKE, true);
    if (!enabled) {
      return { enabled: false, reason: 'ESL_REFRESH_PRE_WAKE=false' };
    }

    const sendMqtt = readBool(process.env.ESL_REFRESH_PRE_WAKE_MQTT, true);
    const sendWs = readBool(process.env.ESL_REFRESH_PRE_WAKE_WS, true);
    const psmDurationMs = Math.max(3000, Math.min(60000, Number(process.env.ESL_REFRESH_PSM_DURATION_MS ?? 12000)));
    const svcCfg = await this.dispatchSilentWakeCommand(apId, storeCode, this.buildSilentServiceConfigCommand(), { sendMqtt, sendWs });
    await wait(Number(process.env.ESL_REFRESH_PRE_WAKE_DELAY_MS ?? 300));
    const psm = await this.dispatchSilentWakeCommand(apId, storeCode, this.buildSilentPsmCommand(psmDurationMs), { sendMqtt, sendWs });
    await wait(Number(process.env.ESL_REFRESH_PRE_WRITE_DELAY_MS ?? 500));
    return {
      enabled: true,
      psmDurationMs,
      serviceConfig: svcCfg,
      psm,
    };
  }

  private scheduleDeferredRefreshRetry(labelId: string, taskId: string, delayMs = REFRESH_DEFERRED_RETRY_DELAY_MS) {
    const retryEnabled = readBool(process.env.ESL_REFRESH_AUTO_RETRY, true);
    if (!retryEnabled) return;
    const task = this.db.cloudTasks.get(taskId);
    if (!task || this.supersedeIfStaleRefreshTask(task)) return;
    if (this.deferredRefreshTimers.has(taskId)) return;

    const timer = setTimeout(() => {
      this.deferredRefreshTimers.delete(taskId);
      void this.requeueDeferredRefreshIfNeeded(labelId, taskId).catch((error) => {
        this.db.recordRequest({
          method: 'LOCAL-IMAGE-DEFERRED-RETRY',
          path: `/labels/${labelId}`,
          statusCode: 500,
          body: { labelId, taskId, error: error instanceof Error ? error.message : String(error) },
        });
      });
    }, delayMs);
    this.deferredRefreshTimers.set(taskId, timer);
  }

  private clearDeferredRefreshTimer(taskId: string) {
    const timer = this.deferredRefreshTimers.get(taskId);
    if (!timer) return;
    clearTimeout(timer);
    this.deferredRefreshTimers.delete(taskId);
  }

  private async requeueDeferredRefreshIfNeeded(labelId: string, taskId: string) {
    const task = this.db.cloudTasks.get(taskId);
    if (!task || task.parentTaskId) return;
    if (this.supersedeIfStaleRefreshTask(task)) return;
    const status = String(task.status ?? '');
    if (status === 'success') return;

    const payload = task.payload && typeof task.payload === 'object' ? task.payload as Row : {};
    const label = this.db.labels.get(labelId);
    if (!label) {
      task.status = 'failed';
      task.resultMsg = '刷新失败：标签不存在，无法重试。';
      task.updatedAt = now();
      task.payload = { ...payload, retryInFlight: false };
      this.db.cloudTasks.set(taskId, task);
      this.db.save();
      return;
    }

    const apId = this.resolveDeliveryApId(label);
    if (!apId) {
      task.status = 'trigger_pending';
      task.resultMsg = `没有可用基站，任务保持待触发；系统将在 ${Math.round(REFRESH_DEFERRED_RETRY_DELAY_MS / 1000)} 秒后继续检查。`;
      task.payload = { ...payload, retryInFlight: false };
      task.updatedAt = now();
      this.db.cloudTasks.set(taskId, task);
      this.db.saveDeferred();
      this.scheduleDeferredRefreshRetry(labelId, taskId);
      return;
    }

    const retryableStatuses = new Set(['sending', 'timeout', 'trigger_pending']);
    if (!retryableStatuses.has(status)) return;

    if (payload.deferredRetryExhausted === true) {
      task.status = 'failed';
      task.resultMsg = `刷新失败：待触发期间已重试 ${numberValue(payload.deferredRetryAttempts, REFRESH_DEFERRED_RETRY_MAX)} 次，仍未收到价签确认。`;
      task.payload = { ...payload, retryInFlight: false };
      task.updatedAt = now();
      this.db.cloudTasks.set(taskId, task);
      this.db.saveDeferred();
      return;
    }

    const attempts = numberValue(payload.deferredRetryAttempts, 0);
    if (attempts >= REFRESH_DEFERRED_RETRY_MAX) {
      task.status = 'failed';
      task.resultMsg = `刷新失败：待触发期间已间隔重试 ${REFRESH_DEFERRED_RETRY_MAX} 次，仍未收到价签确认。请确认标签在基站范围内且在线后手动重试。`;
      task.payload = { ...payload, retryInFlight: false, deferredRetryExhausted: true };
      task.updatedAt = now();
      this.db.cloudTasks.set(taskId, task);
      this.db.saveDeferred();
      return;
    }

    if (!this.isLabelScannedByAp(label, apId, LABEL_ONLINE_STABLE_MS)) {
      const nextAttempts = attempts + 1;
      task.status = 'trigger_pending';
      task.apId = apId;
      task.resultMsg = `标签暂未被基站扫描确认，待触发第 ${nextAttempts}/${REFRESH_DEFERRED_RETRY_MAX} 次检查；系统将在 ${Math.round(REFRESH_DEFERRED_RETRY_DELAY_MS / 1000)} 秒后继续尝试。`;
      task.payload = {
        ...payload,
        retryInFlight: false,
        deferredRetryAttempts: nextAttempts,
        lastDeferredRetryAt: now(),
      };
      task.updatedAt = now();
      this.db.cloudTasks.set(taskId, task);
      this.db.saveDeferred();
      this.scheduleDeferredRefreshRetry(labelId, taskId);
      return;
    }

    const nextAttempts = attempts + 1;
    task.status = 'queued';
    task.apId = apId;
    task.resultMsg = `标签已被基站扫描到，待触发第 ${nextAttempts}/${REFRESH_DEFERRED_RETRY_MAX} 次重新下发。`;
    task.payload = {
      ...payload,
      retryInFlight: false,
      preflightWakeRequired: false,
      deferredRetryAttempts: nextAttempts,
      lastDeferredRetryAt: now(),
    };
    task.updatedAt = now();
    this.db.cloudTasks.set(taskId, task);
    this.db.saveDeferred();
    await this.enqueueRefreshTask(apId, taskId);
  }

  private isLabelScannedByAp(label: Label, apId?: string, maxAgeMs = LABEL_OFFLINE_AFTER_MS) {
    if (!apId) return false;
    const ap = this.db.baseStations.get(apId);
    const discoveredLabels = ap?.discoveredLabels && typeof ap.discoveredLabels === 'object'
      ? ap.discoveredLabels as Record<string, Row>
      : {};
    const discovered = discoveredLabels[label.id];
    const lastSeenAt = stringValue(discovered?.lastSeenAt);
    return Boolean(discovered) && isWithinMs(lastSeenAt || label.updatedAt, maxAgeMs);
  }

  private recentlyScannedApIdsForLabel(label: Label, maxAgeMs = LABEL_ONLINE_STABLE_MS) {
    return [...this.db.baseStations.values()]
      .map((ap) => {
        const discoveredLabels = ap.discoveredLabels && typeof ap.discoveredLabels === 'object'
          ? ap.discoveredLabels as Record<string, Row>
          : {};
        const discovered = discoveredLabels[label.id];
        const lastSeenAt = stringValue(discovered?.lastSeenAt);
        const lastSeenMs = new Date(lastSeenAt || '').getTime();
        return {
          apId: ap.id,
          connected: this.apWebsocket.getConnectionStatus(ap.id).connected,
          online: ap.status === 'online' && isRecentActivity(ap.lastSeenAt),
          seenAt: Number.isFinite(lastSeenMs) ? lastSeenMs : 0,
          recent: Boolean(discovered) && isWithinMs(lastSeenAt || label.updatedAt, maxAgeMs),
        };
      })
      .filter((item) => item.recent)
      .sort((left, right) => {
        if (left.connected !== right.connected) return left.connected ? -1 : 1;
        if (left.online !== right.online) return left.online ? -1 : 1;
        return right.seenAt - left.seenAt;
      })
      .map((item) => item.apId);
  }

  private hasRecentVerifiedLabelContact(label: Label, maxAgeMs = LABEL_ONLINE_STABLE_MS, apId = label.apId) {
    const row = label as Label & Row;
    const connectivity = row.connectivity && typeof row.connectivity === 'object' ? row.connectivity as Row : {};
    if (stringValue(connectivity.state) === 'online' && isWithinMs(connectivity.checkedAt, maxAgeMs)) return true;
    if (label.status === 'online' && isWithinMs(label.updatedAt, maxAgeMs)) return true;
    if (!label.apId) return false;
    return this.isLabelScannedByAp(label, apId, maxAgeMs) || this.isLabelScannedByAp(label, label.apId, maxAgeMs);
  }

  private startLabelKeepaliveLoops() {
    const enabled = readBool(process.env.ESL_LABEL_KEEPALIVE_ENABLED, true);
    if (!enabled || this.labelKeepaliveTimer) return;

    const intervalMs = Math.max(30_000, Math.min(300_000, Number(process.env.ESL_LABEL_KEEPALIVE_INTERVAL_MS ?? 90_000)));
    setTimeout(() => {
      for (const ap of this.db.baseStations.values()) {
        void this.keepaliveLabelsForAp(ap.id).catch(() => undefined);
      }
    }, Math.max(5000, Math.min(120_000, Number(process.env.ESL_LABEL_KEEPALIVE_INITIAL_DELAY_MS ?? 20_000))));
    this.labelKeepaliveTimer = setInterval(() => {
      for (const ap of this.db.baseStations.values()) {
        void this.keepaliveLabelsForAp(ap.id).catch((error) => {
          this.db.recordRequest({
            method: 'LABEL-KEEPALIVE',
            path: `/ap/${ap.id}`,
            statusCode: 500,
            body: { apId: ap.id, error: error instanceof Error ? error.message : String(error) },
          });
        });
      }
    }, intervalMs);
  }

  // 定时清理超过 N 天（默认 3 天）的刷新任务，释放内存与数据库空间。
  private startTaskCleanupLoop() {
    if (this.taskCleanupTimer) return;
    const enabled = readBool(process.env.ESL_TASK_CLEANUP_ENABLED, true);
    if (!enabled) return;
    const intervalMs = Math.max(600_000, Number(process.env.ESL_TASK_CLEANUP_INTERVAL_MS ?? 6 * 60 * 60 * 1000));
    // 启动后延迟首次执行，避免与开机恢复逻辑争抢
    setTimeout(() => this.purgeExpiredTasks(), Math.max(30_000, Number(process.env.ESL_TASK_CLEANUP_INITIAL_DELAY_MS ?? 120_000)));
    this.taskCleanupTimer = setInterval(() => this.purgeExpiredTasks(), intervalMs);
  }

  private taskTimestampMs(task: Row): number | null {
    const raw = stringValue(task.createdAt) || stringValue(task.triggeredAt) || stringValue(task.updatedAt);
    if (!raw) return null;
    const ts = new Date(raw).getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  private purgeExpiredTasks(): number {
    const retentionDays = Math.max(1, Number(process.env.ESL_TASK_RETENTION_DAYS ?? 3));
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const [taskId, task] of this.db.cloudTasks) {
      const ts = this.taskTimestampMs(task as Row);
      if (ts === null || ts >= cutoff) continue;
      this.clearDeferredRefreshTimer(taskId);
      this.db.cloudTasks.delete(taskId);
      removed += 1;
    }
    if (removed > 0) {
      this.db.save();
      this.db.recordRequest({
        method: 'TASK-CLEANUP',
        path: '/tasks/auto-purge',
        statusCode: 200,
        body: { removed, retentionDays },
      });
    }
    return removed;
  }

  private importDiscoveredLabelsForAp(ap: BaseStation & Row) {
    const discoveredLabels = ap.discoveredLabels && typeof ap.discoveredLabels === 'object'
      ? ap.discoveredLabels as Record<string, Row>
      : {};
    const storeCode = stringValue(ap.storeCode, process.env.UPSTREAM_STORE_CODE ?? '20248517');
    const timestamp = now();
    let importedCount = 0;
    for (const [rawLabelId, discovered] of Object.entries(discoveredLabels)) {
      const labelId = stringValue((discovered as Row).eslCode, rawLabelId).toLowerCase();
      if (!labelId) continue;
      const current = this.db.labels.get(labelId);
      const currentRow = (current ?? {}) as Label & Row;
      const signal = numberValue((discovered as Row).signal, numberValue(current?.rssi, 0));
      const label: Label & Row = {
        ...currentRow,
        id: labelId,
        storeCode: current?.storeCode ?? storeCode,
        apId: ap.id,
        sku: current?.sku ?? labelId,
        title: current?.title ?? `ESL ${labelId}`,
        price: current?.price ?? 0,
        currency: current?.currency ?? 'CNY',
        status: labelStatusValue((discovered as Row).status),
        battery: current?.battery,
        rssi: signal,
        services: recordValue((discovered as Row).services) ?? recordValue(currentRow.services),
        ownerUserId: currentRow.ownerUserId ?? ap.ownerUserId,
        updatedAt: stringValue((discovered as Row).lastSeenAt, timestamp),
      };
      this.db.labels.set(label.id, label);
      importedCount += current ? 0 : 1;
    }
    ap.metrics = {
      ...(ap.metrics ?? {}),
      labelsOnline: Object.keys(discoveredLabels).length,
      labelsTotal: Object.keys(discoveredLabels).length,
    };
    if (importedCount > 0) {
      this.db.recordRequest({
        method: 'AP-AUTO-IMPORT',
        path: `/aps/${ap.id}/discovered-labels`,
        statusCode: 200,
        body: { apId: ap.id, importedCount, discoveredCount: Object.keys(discoveredLabels).length },
      });
    }
  }

  private recoverLabelsFromDiscoveredCaches() {
    let importedCount = 0;
    for (const ap of this.db.baseStations.values() as Iterable<BaseStation & Row>) {
      const discoveredLabels = ap.discoveredLabels && typeof ap.discoveredLabels === 'object'
        ? ap.discoveredLabels as Record<string, Row>
        : {};
      if (!Object.keys(discoveredLabels).length) continue;
      if (!apAutoImportEnabled(ap) && ![...this.db.labels.values()].some((label) => label.apId === ap.id)) {
        continue;
      }
      const before = this.db.labels.size;
      this.importDiscoveredLabelsForAp(ap);
      importedCount += this.db.labels.size - before;
    }
    if (importedCount <= 0) return;
    this.db.save();
    this.db.recordRequest({
      method: 'AP-DISCOVERED-RECOVERY',
      path: '/aps/discovered-labels/recover',
      statusCode: 200,
      body: { importedCount },
    });
  }

  private recoverDiscoveredLabelsFromRequestLogs() {
    const recovered = new Map<string, {
      apId: string;
      labelId: string;
      payload: Row;
      time: string;
    }>();
    let matchedBatches = 0;
    let scannedLabelCount = 0;

    for (const log of this.db.requestLogs) {
      const parsed = this.parseDeviceRetrieveLog(log.body);
      if (!parsed) continue;

      const entries = Object.entries(parsed.data ?? {})
        .map(([rawLabelId, payload]) => ({
          labelId: stringValue(rawLabelId).toLowerCase(),
          payload: recordValue(payload) ?? {},
        }))
        .filter((entry) => entry.labelId);
      if (!entries.length) continue;

      const ap = this.resolveRetrieveLogAp(entries.map((entry) => entry.labelId));
      if (!ap) continue;

      matchedBatches += 1;
      scannedLabelCount += entries.length;
      for (const entry of entries) {
        if (!recovered.has(entry.labelId)) {
          recovered.set(entry.labelId, {
            apId: ap.id,
            labelId: entry.labelId,
            payload: entry.payload,
            time: stringValue(log.time, now()),
          });
        }
      }
    }

    if (!recovered.size) return;

    const discoveredByAp = new Map<string, Record<string, Row>>();
    let importedCount = 0;
    for (const item of recovered.values()) {
      const ap = this.db.baseStations.get(item.apId) as BaseStation & Row | undefined;
      if (!ap) continue;

      const discoveredLabels = discoveredByAp.get(ap.id)
        ?? { ...((ap.discoveredLabels && typeof ap.discoveredLabels === 'object' ? ap.discoveredLabels : {}) as Record<string, Row>) };
      const signal = averageRssiValue(item.payload.master_rx_rssi);
      discoveredLabels[item.labelId] = {
        eslCode: item.labelId,
        status: 'online',
        signal,
        lastSeenAt: item.time,
        source: 'DEVICE_RETRIEVE_LOG_RECOVERY',
        services: recordValue(item.payload.service_list),
      };
      discoveredByAp.set(ap.id, discoveredLabels);

      const current = this.db.labels.get(item.labelId);
      if (current) continue;

      const label: Label & Row = {
        id: item.labelId,
        storeCode: stringValue(ap.storeCode, process.env.UPSTREAM_STORE_CODE ?? '20248517'),
        apId: ap.id,
        sku: item.labelId,
        title: `ESL ${item.labelId}`,
        price: 0,
        currency: 'CNY',
        status: 'online',
        rssi: signal,
        services: recordValue(item.payload.service_list),
        ownerUserId: stringValue(ap.ownerUserId),
        updatedAt: item.time,
      };
      this.db.labels.set(label.id, label);
      importedCount += 1;
    }

    for (const [apId, discoveredLabels] of discoveredByAp.entries()) {
      const ap = this.db.baseStations.get(apId) as BaseStation & Row | undefined;
      if (!ap) continue;
      this.db.baseStations.set(ap.id, {
        ...ap,
        discoveredLabels: discoveredLabels as BaseStation['discoveredLabels'],
        metrics: {
          ...(ap.metrics ?? {}),
          labelsOnline: Object.keys(discoveredLabels).length,
          labelsTotal: Object.keys(discoveredLabels).length,
        },
      });
    }

    if (!importedCount && discoveredByAp.size === 0) return;
    this.db.save();
    if (importedCount > 0) {
      this.db.recordRequest({
        method: 'AP-LOG-RECOVERY',
        path: '/request-logs/device-retrieve/recover',
        statusCode: 200,
        body: {
          importedCount,
          recoveredLabels: recovered.size,
          matchedBatches,
          scannedLabelCount,
        },
      });
    }
  }

  private parseDeviceRetrieveLog(body: unknown): { data?: Record<string, unknown> } | undefined {
    const row = recordValue(body);
    const text = stringValue(row?.text);
    if (!text || !text.includes('DEVICE_RETRIEVE')) return undefined;
    try {
      const parsed = JSON.parse(text) as Row;
      return parsed.type === 'DEVICE_RETRIEVE' && recordValue(parsed.data)
        ? { data: parsed.data as Record<string, unknown> }
        : undefined;
    } catch {
      return undefined;
    }
  }

  private resolveRetrieveLogAp(labelIds: string[]) {
    const scores = new Map<string, number>();
    for (const labelId of labelIds) {
      const current = this.db.labels.get(labelId);
      if (current?.apId) {
        scores.set(current.apId, (scores.get(current.apId) ?? 0) + 1);
      }
    }
    for (const ap of this.db.baseStations.values()) {
      const discoveredLabels = ap.discoveredLabels ?? {};
      let score = scores.get(ap.id) ?? 0;
      for (const labelId of labelIds) {
        if (discoveredLabels[labelId]) score += 1;
      }
      if (score > 0) scores.set(ap.id, score);
    }

    const [best] = [...scores.entries()].sort((left, right) => right[1] - left[1]);
    if (best && best[1] >= Math.min(3, labelIds.length)) {
      return this.db.baseStations.get(best[0]);
    }

    const autoImportAps = [...this.db.baseStations.values()].filter((ap) => apAutoImportEnabled(ap as BaseStation & Row));
    if (autoImportAps.length === 1) return autoImportAps[0];

    const onlineAps = [...this.db.baseStations.values()].filter((ap) => ap.status === 'online');
    return onlineAps.length === 1 ? onlineAps[0] : undefined;
  }

  private async keepaliveLabelsForAp(apId: string) {
    const ap = this.db.baseStations.get(apId);
    if (!ap || ap.status !== 'online' || !this.apWebsocket.getConnectionStatus(apId).connected) return;
    if (this.labelKeepaliveInFlightByAp.has(apId)) return;
    if (await this.refreshQueue.isApBusy(apId)) return;

    const labels = this.nextKeepaliveLabelsForAp(apId);
    if (!labels.length) return;

    this.labelKeepaliveInFlightByAp.add(apId);
    try {
      await this.runSilentWake(labels.map((label) => label.id), {
        apId,
        waitMs: Math.max(3000, Math.min(15000, Number(process.env.ESL_LABEL_KEEPALIVE_WAIT_MS ?? 5000))),
        psmDurationMs: Math.max(3000, Math.min(30000, Number(process.env.ESL_LABEL_KEEPALIVE_PSM_DURATION_MS ?? 12000))),
        sendMqtt: true,
        sendWs: true,
        disconnectAfterProbe: true,
      });
    } finally {
      this.labelKeepaliveInFlightByAp.delete(apId);
    }
  }

  private nextKeepaliveLabelsForAp(apId: string) {
    const limit = Math.max(1, Math.min(30, Number(process.env.ESL_LABEL_KEEPALIVE_BATCH_SIZE ?? 10)));
    const allLabels = [...this.db.labels.values()]
      .filter((label) => label.apId === apId)
      .sort((left, right) => this.labelProbePriority(left) - this.labelProbePriority(right));
    const candidates = allLabels.filter((label) => this.shouldProbeLabel(label));
    if (!candidates.length) return [];
    const start = this.labelKeepaliveCursorByAp.get(apId) ?? 0;
    const labels = candidates.slice(start, start + limit);
    this.labelKeepaliveCursorByAp.set(apId, start + limit >= candidates.length ? 0 : start + limit);
    return labels.length ? labels : candidates.slice(0, limit);
  }

  private labelProbePriority(label: Label) {
    const row = label as Label & Row;
    const connectivity = row.connectivity && typeof row.connectivity === 'object' ? row.connectivity as Row : {};
    if (label.status !== 'online') return 0;
    const checkedAt = stringValue(connectivity.checkedAt, label.updatedAt);
    return new Date(checkedAt || 0).getTime() || 0;
  }

  private shouldProbeLabel(label: Label) {
    const row = label as Label & Row;
    const connectivity = row.connectivity && typeof row.connectivity === 'object' ? row.connectivity as Row : {};
    const state = stringValue(connectivity.state);
    const checkedAt = stringValue(connectivity.checkedAt, label.updatedAt);
    const nextProbeAt = stringValue(connectivity.nextProbeAt);
    if (nextProbeAt && new Date(nextProbeAt).getTime() > Date.now()) return false;
    if (label.status !== 'online') return true;
    if (state && state !== 'online') return true;
    return !isWithinMs(checkedAt, LABEL_ONLINE_STABLE_MS);
  }

  private async runSilentWake(
    labelIdsInput: string[],
    options: {
      apId?: string;
      waitMs: number;
      psmDurationMs: number;
      sendMqtt: boolean;
      sendWs: boolean;
      disconnectAfterProbe: boolean;
    },
  ) {
    const labelIds = [...new Set(labelIdsInput.map((item) => stringValue(item).toLowerCase()).filter(Boolean))];
    if (!labelIds.length) {
      return { ok: false, reason: 'no_labels', message: '至少要提供一个价签编号' };
    }

    const labels = labelIds.map((labelId) => this.db.labels.get(labelId)).filter(Boolean) as Label[];
    const apId = options.apId
      || labels.map((label) => label.apId).find(Boolean)
      || [...this.db.baseStations.values()].find((item) => item.status === 'online')?.id;
    if (!apId) {
      return { ok: false, reason: 'no_online_ap', message: '没有可用的在线基站，无法执行无感唤醒', labelIds };
    }

    const storeCode = labels[0]?.storeCode ?? [...this.db.stores.values()][0]?.code ?? process.env.UPSTREAM_STORE_CODE ?? '20248517';
    const waitMs = Math.max(3000, Math.min(30000, options.waitMs || 8000));
    const psmDurationMs = Math.max(3000, Math.min(30000, options.psmDurationMs || 8000));
    const startedAt = now();

    await this.dispatchSilentWakeCommand(apId, storeCode, this.buildSilentServiceConfigCommand(), options);
    await wait(250);
    await this.dispatchSilentWakeCommand(apId, storeCode, this.buildSilentPsmCommand(psmDurationMs), options);
    await wait(250);

    const results: SilentWakeResult[] = [];
    for (const labelId of labelIds) {
      const delivery = await this.dispatchSilentWakeCommand(
        apId,
        storeCode,
        this.buildSilentProbeCommand(labelId, options.disconnectAfterProbe),
        options,
      );
      const trackingId = delivery.websocket && typeof delivery.websocket === 'object' && 'trackingId' in delivery.websocket
        ? (delivery.websocket as { trackingId?: string }).trackingId
        : undefined;
      const result = await this.waitForSilentWakeResult(apId, labelId, trackingId, waitMs);
      this.updateSilentWakeConnectivity(labelId, result);
      results.push(result);
      await wait(200);
    }

    this.db.save();
    const onlineCount = results.filter((item) => item.state === 'online').length;
    const wakingCount = results.filter((item) => item.state === 'waking').length;
    return {
      ok: onlineCount === labelIds.length,
      partial: onlineCount > 0 && onlineCount < labelIds.length,
      mode: 'wake',
      startedAt,
      finishedAt: now(),
      apId,
      storeCode,
      total: labelIds.length,
      onlineCount,
      wakingCount,
      labels: results,
      conclusion: onlineCount === labelIds.length
        ? '所有目标价签都已通过无感连接验证，可视为在线。'
        : wakingCount > 0
          ? '部分价签仍处于唤醒中，AP 已开始尝试建立连接，但尚未全部拿到成功反馈。'
          : '没有拿到明确的无感在线反馈，当前仍不能视为稳定在线。',
    };
  }

  private async dispatchSilentWakeCommand(
    apId: string,
    storeCode: string,
    command: Row,
    options: { sendMqtt: boolean; sendWs: boolean },
  ) {
    const normalizedAp = apId.trim();
    const apUpper = normalizedAp.toUpperCase();
    const apNoColonUpper = normalizedAp.replace(/:/g, '').toUpperCase();
    const apNoColonLower = normalizedAp.replace(/:/g, '').toLowerCase();
    const topics = [...new Set([
      `${storeCode}/${normalizedAp}/cmd`,
      `${storeCode}/${apUpper}/cmd`,
      `${storeCode}/${apNoColonUpper}/cmd`,
      `${storeCode}/${apNoColonLower}/cmd`,
    ])];
    let mqtt: Row = { ok: false, skipped: true };
    if (options.sendMqtt) {
      const results = await Promise.all(topics.map(async (topic) => {
        try {
          await this.mqtt.publishJson(topic, command, { retain: false });
          return { ok: true, topic };
        } catch (error) {
          return { ok: false, topic, reason: error instanceof Error ? error.message : String(error) };
        }
      }));
      mqtt = { ok: results.some((item) => item.ok), topics: results };
    }
    const websocket = options.sendWs ? this.apWebsocket.sendRaw(apId, command) : { ok: false, skipped: true };
    return { mqtt, websocket };
  }

  private buildSilentServiceConfigCommand() {
    return {
      type: 'AP_SVC_CFG',
      adv_group: 32,
      adv_psm_interval_sec: 60,
      adv_listen_slave_enable: true,
      adv_psm_cfg: {
        enable: true,
        duration_ms: 5000,
        act_time_us: 3000,
        slp_cycle_ms: 4000,
        adv_interval_ms: 60000,
        adv_map: 7,
        wait_conn_ch_idx: 10,
      },
      rd_wr_svc_cfg: {
        retry_num: 3,
        parallel_num: 3,
        ap_chn_num: 255,
      },
    };
  }

  private buildSilentPsmCommand(durationMs: number) {
    return {
      type: 'AP_PSM',
      data: {
        mode: 'fast',
        adv_group: 32,
        merge: {
          enable: true,
          duration_ms: durationMs,
          act_time_us: 3000,
          slp_cycle_ms: 4000,
          adv_interval_ms: 60000,
          retry_num: 3,
          parallel_num: 3,
          ap_chn_num: 255,
        },
      },
    };
  }

  private buildSilentProbeCommand(labelId: string, disconnectAfterProbe: boolean) {
    return {
      type: 'READ_WRITE_SVC',
      opas: [
        {
          addr: labelId,
          cmds: [
            { id: 0, type: 'CONN_DEV' },
            ...(disconnectAfterProbe ? [{ id: 1, type: 'DIS_CONN' }] : []),
          ],
        },
      ],
    };
  }

  private async waitForSilentWakeResult(apId: string, labelId: string, trackingId: string | undefined, timeoutMs: number): Promise<SilentWakeResult> {
    if (!trackingId) {
      return { labelId, ok: false, state: 'unknown', stage: 'not_sent', detail: '没有拿到 WebSocket trackingId，无法执行无感唤醒' };
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const trace = this.apWebsocket.getDownlinkTrace(apId, trackingId);
      const row = trace && typeof trace === 'object' ? trace as Row : undefined;
      const reply = row?.reply && typeof row.reply === 'object' ? row.reply as Row : undefined;
      const payload = reply?.payload && typeof reply.payload === 'object' ? reply.payload as Row : undefined;
      const cmd = payload?.cmd && typeof payload.cmd === 'object' ? payload.cmd as Row : undefined;
      const res = payload?.res && typeof payload.res === 'object' ? payload.res as Row : undefined;
      const cmdType = typeof cmd?.type === 'string' ? cmd.type : undefined;
      const errno = typeof res?.errno === 'number'
        ? res.errno
        : typeof payload?.errno === 'number'
          ? payload.errno
          : undefined;
      const tasksCount = Number(payload?.tasks_count ?? payload?.tasksCount);
      const traceStatus = typeof row?.status === 'string' ? row.status : undefined;

      if (
        ((cmdType === 'CONN_DEV' || cmdType === 'DIS_CONN') && errno === 0)
        || (cmdType === 'DIS_CONN' && (errno === 0 || errno === undefined) && tasksCount === 0)
      ) {
        return {
          labelId,
          trackingId,
          ok: true,
          state: 'online',
          stage: 'conn_dev_ok',
          detail: cmdType === 'DIS_CONN' ? '已收到 DIS_CONN 成功回包，说明前置连接阶段已完成' : '已收到 CONN_DEV 成功回包，标签当前可视为在线',
          errno,
          cmdType,
          traceStatus,
        };
      }

      if (cmdType === 'CONN_DEV' && typeof errno === 'number' && errno !== 0) {
        return {
          labelId,
          trackingId,
          ok: false,
          state: 'offline',
          stage: 'conn_dev_failed',
          detail: `无感唤醒失败：CONN_DEV errno=${errno}`,
          errno,
          cmdType,
          traceStatus,
        };
      }

      await wait(400);
    }

    return { labelId, trackingId, ok: false, state: 'waking', stage: 'timeout', detail: '无感唤醒超时：AP 已开始尝试连接，但还没有拿到明确成功/失败回包' };
  }

  private updateSilentWakeConnectivity(labelId: string, result: SilentWakeResult) {
    const current = this.db.labels.get(labelId);
    if (!current) return;
    const row = current as Label & Row;
    const previousConnectivity = row.connectivity && typeof row.connectivity === 'object' ? row.connectivity as Row : {};
    const previousFailures = numberValue(previousConnectivity.offlineProbeFailures, 0);
    const nextFailures = result.state === 'online' ? 0 : previousFailures + 1;
    const offlineConfirmed = result.state !== 'online' && nextFailures >= LABEL_OFFLINE_PROBE_MAX;
    row.status = result.state === 'online' ? 'online' : offlineConfirmed ? 'offline' : current.status;
    row.connectivity = {
      mode: 'silent_wake',
      state: result.state === 'online' ? 'online' : offlineConfirmed ? 'offline' : 'waking',
      checkedAt: now(),
      detail: `无感唤醒：${result.detail}`,
      trackingId: result.trackingId,
      offlineProbeFailures: nextFailures,
      nextProbeAt: result.state === 'online'
        ? new Date(Date.now() + LABEL_ONLINE_STABLE_MS).toISOString()
        : new Date(Date.now() + (offlineConfirmed ? LABEL_ONLINE_STABLE_MS : LABEL_OFFLINE_PROBE_RETRY_DELAY_MS)).toISOString(),
    };
    if (result.state === 'online') {
      row.updatedAt = now();
    }
    this.db.labels.set(labelId, row);
    if (result.state !== 'online' && !offlineConfirmed) {
      this.scheduleLabelOfflineProbe(labelId);
    }
  }

  private scheduleLabelOfflineProbe(labelId: string) {
    if (this.labelOfflineProbeTimers.has(labelId)) return;
    const timer = setTimeout(() => {
      this.labelOfflineProbeTimers.delete(labelId);
      void this.retryOfflineLabelProbe(labelId).catch((error) => {
        this.db.recordRequest({
          method: 'LABEL-OFFLINE-PROBE',
          path: `/labels/${labelId}`,
          statusCode: 500,
          body: { labelId, error: error instanceof Error ? error.message : String(error) },
        });
      });
    }, LABEL_OFFLINE_PROBE_RETRY_DELAY_MS);
    this.labelOfflineProbeTimers.set(labelId, timer);
  }

  private async retryOfflineLabelProbe(labelId: string) {
    const label = this.db.labels.get(labelId);
    if (!label?.apId) return;
    if (this.hasRecentVerifiedLabelContact(label)) return;
    if (await this.refreshQueue.isApBusy(label.apId)) {
      this.scheduleLabelOfflineProbe(labelId);
      return;
    }
    await this.runSilentWake([labelId], {
      apId: label.apId,
      waitMs: Math.max(3000, Math.min(15000, Number(process.env.ESL_LABEL_KEEPALIVE_WAIT_MS ?? 5000))),
      psmDurationMs: Math.max(3000, Math.min(30000, Number(process.env.ESL_LABEL_KEEPALIVE_PSM_DURATION_MS ?? 12000))),
      sendMqtt: true,
      sendWs: true,
      disconnectAfterProbe: true,
    });
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
    const preset = this.resolveScreenPreset(render, labelId);
    const packetColorMode = this.normalizeTemplateColorMode(render.colorMode);
    const packing = preset.packing ?? (preset.bpp === 1 ? '1bpp' : '2bpp');
    const physicalOneBit = preset.bpp === 1 || packing === '1bpp' || packing === 'bwr_planes';
    const preserveHardEdges = physicalOneBit || packetColorMode === 'bw' || packetColorMode === 'bwr';
    const resampleKernel = preserveHardEdges ? 'nearest' : 'linear';
    const sourceRgba = preset.service === '01-00-00-0c'
      ? await this.renderIntoService0cCanvas(render, preset.width, preset.height)
      : await this.transformRenderedRgba(render.rgba, render.width, render.height, preset.width, preset.height, preset.rotate, preset.mirrorX, resampleKernel);
    const packedRows = packing === 'bwr_planes'
      ? this.packImageBwrPlanes(sourceRgba, preset.width, preset.height)
      : packing === '1bpp'
        ? this.packImage1Bpp(sourceRgba, preset.width, preset.height)
        : this.packImage2Bpp(sourceRgba, preset.width, preset.height, packetColorMode);
    const imageBytes = this.buildChunkedImageContainer(preset.magic, packedRows);
    const clearBeforeWrite = false;
    const imageWriteOptions = {
      ...(preset.supersize ? { supersize: true, mtu: preset.mtu ?? 10000 } : {}),
      ...(preset.service === '01-00-00-03' ? { bigsize: false, mtu: preset.mtu ?? 10000 } : {}),
    };
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
              ...imageWriteOptions,
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
      clearBeforeWrite,
      imageFormat: `${preset.service}/${packing === 'bwr_planes' ? 'bwr-planes' : `${packing === '1bpp' ? 1 : 2}bpp${packetColorMode === 'bw' && packing !== '1bpp' ? '-bw-palette' : ''}`}`,
      renderMode: preset.mode,
      fit: 'stretch',
      resample: resampleKernel === 'nearest' ? 'nearest' : 'bilinear',
      dither: packetColorMode !== 'bwr',
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
    if (!template) {
      throw new BadRequestException('No template available');
    }
    const schema = (template.schema && typeof template.schema === 'object' ? template.schema : defaultSchema(template)) as Row;
    const width = numberValue(template.width, 800);
    const height = numberValue(template.height, 480);
    const colorMode = this.normalizeTemplateColorMode(template.colorMode);
    const normalizedSchema = resizeSchemaToCanvas(schema, width, height, stringValue(template.deviceType, 'ET0750-89'), colorMode);
    const bindings = this.buildTemplateBindings(label, product);
    const svg = await this.renderTemplateSvg(normalizedSchema, bindings, width, height, colorMode);
    const { data: rgba } = await sharp(Buffer.from(svg))
      .resize(width, height, { fit: 'fill', kernel: 'linear' })
      .flatten({ background: '#ffffff' })
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
      sourceId: bindingTextValue(source.sourceId, bindingTextValue(source.sku, label.sku ?? label.id)),
      id: label.id,
      eslCode: label.id,
      sku: bindingTextValue(source.sku, label.sku ?? label.id),
      reference: bindingTextValue(source.reference, bindingTextValue(source.barcode, label.sku ?? label.id)),
      barcode: bindingTextValue(source.barcode, label.sku ?? label.id),
      name: bindingTextValue(source.name, label.title),
      title: bindingTextValue(source.name, label.title),
      subName: bindingTextValue(source.subName),
      brand: bindingTextValue(source.brand),
      category: bindingTextValue(source.category),
      price: price.toFixed(2),
      field1: price.toFixed(2),
      originalPrice: numberValue(source.originalPrice, price).toFixed(2),
      memberPrice: numberValue(source.memberPrice, price).toFixed(2),
      promotionPrice: numberValue(source.promotionPrice, price).toFixed(2),
      field2: numberValue(source.promotionPrice, price).toFixed(2),
      promotionText: bindingTextValue(source.promotionText),
      unit: bindingTextValue(source.unit),
      specification: bindingTextValue(source.specification),
      imageUrl: bindingTextValue(source.imageUrl),
      ...Object.fromEntries(Array.from({ length: 22 }, (_, index) => {
        const key = `customField${index + 1}`;
        return [key, bindingTextValue(source[key], bindingTextValue(customFields[key]))];
      })),
    };
  }

  private async renderTemplateSvg(schema: Row, bindings: Record<string, string>, width: number, height: number, colorMode: string = 'bwr') {
    const elements = Array.isArray(schema?.elements) ? schema.elements as Row[] : [];
    const body = (await Promise.all(elements
      .filter((item) => item.visible !== false)
      .sort((left, right) => numberValue(left.zIndex, 0) - numberValue(right.zIndex, 0))
      .map((item, index) => this.renderPreviewElement(item, bindings, index, colorMode === 'bw' || colorMode === 'bwr'))))
      .join('');
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      '<rect width="100%" height="100%" fill="#ffffff"/>',
      body,
      '</svg>',
    ].join('');
  }

  private resolveScreenPreset(render: RenderedTemplateImage, labelId?: string) {
    const colorMode = this.normalizeTemplateColorMode(render.colorMode);
    const normalizedLabelId = stringValue(labelId).toLowerCase();
    const explicitKey = LABEL_PRESET_KEYS[normalizedLabelId]
      ?? LABEL_PREFIX_PRESET_KEYS.find((item) => normalizedLabelId.startsWith(item.prefix))?.key;
    const explicit = explicitKey ? SCREEN_PRESETS.find((preset) => preset.key === explicitKey) : undefined;
    if (explicit) return explicit;

    const exact = SCREEN_PRESETS.find((preset) => (
      preset.width === render.width
      && preset.height === render.height
      && this.presetSupportsColorMode(preset, colorMode)
    ));
    if (exact) return exact;
    const rotated = SCREEN_PRESETS.find((preset) => (
      preset.width === render.height
      && preset.height === render.width
      && this.presetSupportsColorMode(preset, colorMode)
    ));
    if (rotated) return rotated;

    return SCREEN_PRESETS.find((preset) => this.presetSupportsColorMode(preset, colorMode)) ?? SCREEN_PRESETS[0];
  }

  private normalizeTemplateColorMode(value: unknown): 'bw' | 'bwr' | 'bwry' {
    const normalized = stringValue(value, 'bwr').toLowerCase();
    if (['bw', 'black-white', '2', '2color', '2-color'].includes(normalized)) return 'bw';
    if (['bwry', 'bwyr', '4', '4color', '4-color'].includes(normalized)) return 'bwry';
    return 'bwr';
  }

  private presetSupportsColorMode(preset: ScreenPreset, colorMode: 'bw' | 'bwr' | 'bwry') {
    if (preset.colorMode === colorMode) return true;
    if (colorMode === 'bw') return true;
    return false;
  }

  private async renderIntoService0cCanvas(render: RenderedTemplateImage, width: number, height: number) {
    return sharp(render.rgba, { raw: { width: render.width, height: render.height, channels: 4 } })
      .resize(width, height, { fit: 'fill', kernel: 'linear' })
      .flatten({ background: '#ffffff' })
      .ensureAlpha()
      .raw()
      .toBuffer();
  }

  private async transformRenderedRgba(
    rgba: Buffer,
    sourceWidth: number,
    sourceHeight: number,
    width: number,
    height: number,
    rotate: number,
    mirrorX: boolean,
    kernel: 'nearest' | 'linear' = 'linear',
  ) {
    let pipeline = sharp(rgba, { raw: { width: sourceWidth, height: sourceHeight, channels: 4 } });
    if (rotate) {
      pipeline = pipeline.rotate(rotate);
    }
    if (mirrorX) {
      pipeline = pipeline.flop();
    }
    return pipeline
      .resize(width, height, { fit: 'fill', kernel })
      .flatten({ background: '#ffffff' })
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

  private packImage2Bpp(rgba: Buffer, width: number, height: number, colorMode: string = 'bwry') {
    const output = Buffer.alloc(Math.ceil(width * height / 4), 0x55);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      const code = stringValue(colorMode).includes('bw') && !stringValue(colorMode).includes('r') && !stringValue(colorMode).includes('y')
        ? this.colorCode2BppBw(rgba[offset], rgba[offset + 1], rgba[offset + 2])
        : this.colorCode2Bpp(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
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

  private colorCode2BppBw(r: number, g: number, b: number) {
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    return lum < 160 ? 0 : 1;
  }

  private packImage1Bpp(rgba: Buffer, width: number, height: number) {
    const rowBytes = Math.ceil(width / 8);
    const output = Buffer.alloc(rowBytes * height, 0xff);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const lum = rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114;
        if (lum < 160) {
          output[y * rowBytes + Math.floor(x / 8)] &= ~(1 << (7 - (x % 8)));
        }
      }
    }
    return output;
  }

  private packImageBwrPlanes(rgba: Buffer, width: number, height: number) {
    const rowBytes = Math.ceil(width / 8);
    const black = Buffer.alloc(rowBytes * height, 0xff);
    const red = Buffer.alloc(rowBytes * height, 0x00);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const r = rgba[offset];
        const g = rgba[offset + 1];
        const b = rgba[offset + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const redPixel = (r >= 150 && r - g >= 45 && r - b >= 55)
          || (r >= 155 && g >= 115 && b <= 135 && r + g >= 290 && max - min >= 45);
        const luminance = r * 0.299 + g * 0.587 + b * 0.114;
        const blackPixel = !redPixel && luminance < 145 && max < 185;
        const index = y * rowBytes + Math.floor(x / 8);
        const mask = 1 << (7 - (x % 8));
        if (blackPixel) black[index] &= ~mask;
        if (redPixel) red[index] |= mask;
      }
    }
    return Buffer.concat([black, red]);
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
      ...this.recentlyScannedApIdsForLabel(label),
      label.apId,
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
    }, width, height, 'bw');
  }

  private async renderPreviewElement(item: Row, bindings: Record<string, string> = {}, index = 0, bwMode = false) {
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
      const resolvedHref = await this.resolveImageDataUri(href, width, height);
      return resolvedHref ? `<image href="${escapeXml(resolvedHref)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>` : `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${escapeXml(style.background ?? '#ffffff')}"/>`;
    }
    if (type === 'rect') {
      return this.renderSvgBox(x, y, width, height, style.fill ?? style.background ?? '#ffffff', style.stroke ?? '#111111', numberValue(style.strokeWidth, 1), bwMode);
    }
    if (type === 'line') {
      return `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y + height}" stroke="${escapeXml(style.stroke ?? '#111111')}" stroke-width="${numberValue(style.strokeWidth, 1)}" shape-rendering="crispEdges"/>`;
    }
    if (type === 'barcode') {
      const stroke = escapeXml(style.stroke ?? '#111111');
      const background = escapeXml(style.background ?? '#ffffff');
      const text = boundText || stringValue(item.expression, stringValue(item.bindingField, 'barcode'));
      const barSvg = this.renderBarcodeSvg(text, width, height);
      return `${this.renderSvgBox(x, y, width, height, background, stroke, 1, bwMode)}${fitSvgImage(barSvg, x + 2, y + 2, Math.max(1, width - 4), Math.max(1, height - 4))}`;
    }
    if (type === 'qrcode') {
      const stroke = escapeXml(style.stroke ?? '#111111');
      const background = escapeXml(style.background ?? '#ffffff');
      const text = boundText || stringValue(item.expression, stringValue(item.bindingField, 'QR'));
      const qrSvg = await this.renderQrCodeSvg(text);
      return `${this.renderSvgBox(x, y, width, height, background, stroke, 1, bwMode)}${fitSvgImage(qrSvg, x + 2, y + 2, Math.max(1, width - 4), Math.max(1, height - 4))}`;
    }
    const fontSize = numberValue(style.fontSize, type === 'price' ? 28 : 14);
    const fontWeight = String(style.fontWeight ?? '') === 'bold' ? '700' : '400';
    const fill = escapeXml(style.fill ?? '#111111');
    const stroke = escapeXml(style.stroke ?? '#111111');
    const background = escapeXml(style.background ?? '#ffffff');
    const textAlign = String(style.textAlign ?? 'left');
    const textAnchor = textAlign === 'center' ? 'middle' : textAlign === 'right' ? 'end' : 'start';
    const paddingX = 4;
    const fallbackText = stringValue(item.expression, bindingField ? '' : String(item.bindingField ?? type));
    const text = type === 'price'
      ? (bindingField && !boundText ? '' : `￥${boundText || fallbackText || '19.90'}`)
      : (boundText || fallbackText);
    const autoSize = boolValue(style.autoSize);
    const measured = autoSize ? measureSvgTextBox(text, fontSize, fontWeight) : null;
    const boxWidth = measured?.width ?? width;
    const boxHeight = measured?.height ?? height;
    const textX = textAlign === 'center' ? x + boxWidth / 2 : textAlign === 'right' ? x + boxWidth - paddingX : x + paddingX;
    const clipId = `text-clip-${index}-${escapeXml(String(item.id ?? 'element')).replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const lineHeight = fontSize * 1.18;
    const maxTextWidth = Math.max(1, boxWidth - paddingX * 2);
    const lines = autoSize || String(style.textOverflow ?? 'clip') !== 'wrap'
      ? text.split(/\r?\n/)
      : wrapSvgText(text, maxTextWidth, fontSize, fontWeight);
    const maxLines = Math.max(1, Math.floor(boxHeight / lineHeight));
    const visibleLines = lines.slice(0, maxLines);
    const textNodes = visibleLines.map((line, lineIndex) => (
      `<tspan x="${textX}" dy="${lineIndex === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
    )).join('');
    return `<defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}"/></clipPath></defs>${this.renderSvgBox(x, y, boxWidth, boxHeight, background, stroke, 1, bwMode)}<text clip-path="url(#${clipId})" x="${textX}" y="${y + fontSize}" text-anchor="${textAnchor}" font-size="${fontSize}" font-weight="${fontWeight}" font-family="${SVG_FONT_STACK}" fill="${fill}">${textNodes}</text>`;
  }

  private renderSvgBox(x: number, y: number, width: number, height: number, background: unknown, stroke: unknown, strokeWidth = 1, bwMode = false) {
    const safeStrokeWidth = Math.max(0, numberValue(strokeWidth, 1));
    const safeWidth = Math.max(0, width);
    const safeHeight = Math.max(0, height);
    const effectiveStrokeWidth = bwMode ? Math.max(2, safeStrokeWidth) : safeStrokeWidth;
    const borderWidth = Math.min(effectiveStrokeWidth, safeWidth / 2);
    const borderHeight = Math.min(effectiveStrokeWidth, safeHeight / 2);
    const borderColor = escapeXml(stroke ?? '#111111');
    return [
      `<rect x="${x}" y="${y}" width="${safeWidth}" height="${safeHeight}" fill="${escapeXml(background ?? '#ffffff')}" shape-rendering="crispEdges"/>`,
      effectiveStrokeWidth > 0 && safeWidth > 0 && safeHeight > 0
        ? [
          `<rect x="${x}" y="${y}" width="${safeWidth}" height="${borderHeight}" fill="${borderColor}" shape-rendering="crispEdges"/>`,
          `<rect x="${x}" y="${y + safeHeight - borderHeight}" width="${safeWidth}" height="${borderHeight}" fill="${borderColor}" shape-rendering="crispEdges"/>`,
          `<rect x="${x}" y="${y}" width="${borderWidth}" height="${safeHeight}" fill="${borderColor}" shape-rendering="crispEdges"/>`,
          `<rect x="${x + safeWidth - borderWidth}" y="${y}" width="${borderWidth}" height="${safeHeight}" fill="${borderColor}" shape-rendering="crispEdges"/>`,
        ].join('')
        : '',
    ].join('');
  }

  private renderBarcodeSvg(text: string, width: number, height: number) {
    const barcodeText = stringValue(text, 'barcode');
    try {
      return bwipjs.toSVG({
        bcid: 'code128',
        text: barcodeText,
        scale: 2,
        height: Math.max(6, Math.floor(height * 0.18)),
        includetext: height >= 34,
        textsize: Math.max(7, Math.min(12, Math.floor(height * 0.18))),
        textxalign: 'center',
        backgroundcolor: 'FFFFFF',
        barcolor: '000000',
        textcolor: '000000',
        paddingwidth: 0,
        paddingheight: 0,
      });
    } catch {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(1, width)} ${Math.max(1, height)}"><rect width="100%" height="100%" fill="#fff"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#000">${escapeXml(barcodeText)}</text></svg>`;
    }
  }

  private async renderQrCodeSvg(text: string) {
    return QRCode.toString(stringValue(text, 'QR'), {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
  }

  private async resolveImageDataUri(value: string, width?: number, height?: number) {
    const source = stringValue(value);
    if (!source) return '';

    try {
      let body: Buffer;
      let contentType = 'image/png';
      if (source.startsWith('data:image/')) {
        const match = source.match(/^data:([^;,]+);base64,(.+)$/);
        if (!match) return source.length > 1_000_000 ? '' : source;
        contentType = match[1] || 'image/png';
        body = Buffer.from(match[2], 'base64');
      } else {
        const uploadMatch = source.match(/\/api\/v1\/uploads\/files\/([^/?#]+)/);
        if (uploadMatch?.[1]) {
          const filename = decodeURIComponent(uploadMatch[1]);
          body = await fs.readFile(join(getUploadDir(), filename));
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
      }

      const requestedWidth = numberValue(width, 0);
      const requestedHeight = numberValue(height, 0);
      const targetWidth = requestedWidth > 0 ? Math.max(1, Math.min(2000, Math.ceil(requestedWidth))) : 0;
      const targetHeight = requestedHeight > 0 ? Math.max(1, Math.min(2000, Math.ceil(requestedHeight))) : 0;
      if (targetWidth > 0 && targetHeight > 0 && body.length > 128 * 1024) {
        body = await sharp(body, { animated: false })
          .rotate()
          .resize(targetWidth, targetHeight, { fit: 'cover', kernel: 'linear' })
          .png({ compressionLevel: 9, adaptiveFiltering: true })
          .toBuffer();
        contentType = 'image/png';
      }
      return `data:${contentType};base64,${body.toString('base64')}`;
    } catch {
      return '';
    }
  }

  private ensureDefaultTemplate() {
    const existing = [...this.db.cloudTemplates.values()][0];
    if (existing) return existing;
    if (this.isDefaultTemplateDeleted()) {
      return null;
    }
    return this.upsertTemplate({
      id: DEFAULT_TEMPLATE_ID,
      code: 'DEFAULT_750_480',
      name: 'Kersen 7.5 默认模板',
      deviceType: 'ET0750-89',
      width: 800,
      height: 480,
      colorMode: 'bwr',
      status: 'published',
    });
  }

  private currentUser(request?: Request) {
    this.ensureAdminUser();
    const auth = request?.headers?.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const decoded = token ? this.jwt.decode(token) as Row | null : null;
    const userId = stringValue(decoded?.sub);
    return (userId ? this.db.users.get(userId) : undefined) ?? this.ensureAdminUser();
  }

  private requireAdminUser(request?: Request) {
    const user = this.currentUser(request);
    if (!this.isAdminUser(user)) {
      throw new ForbiddenException('Admin access required');
    }
    return user;
  }

  private isAdminUser(user: Row) {
    return isAdminRoleValue(user.role);
  }

  private rowOwnerId(row?: Row) {
    return String(row?.ownerUserId ?? '');
  }

  private canAdminAccessOwner(currentUser: Row, ownerUserId: string) {
    if (!ownerUserId || ownerUserId === String(currentUser.id ?? '')) return true;
    const owner = this.db.users.get(ownerUserId);
    return !owner || !isAdminRoleValue(owner.role);
  }

  private canAccessRow(row: Row | undefined, request?: Request) {
    if (!row) return false;
    const user = this.currentUser(request);
    if (!this.rowOwnerId(row)) {
      this.ensureOwnershipBackfill();
    }
    const ownerUserId = this.rowOwnerId(row);
    if (this.isAdminUser(user)) return this.canAdminAccessOwner(user, ownerUserId);
    return ownerUserId === String(user.id ?? '');
  }

  private assertRowVisible<T extends Row>(row: T | undefined, request?: Request, message = 'Resource not found'): T {
    if (!row || !this.canAccessRow(row, request)) {
      throw new NotFoundException(message);
    }
    return row;
  }

  private visibleRows<T extends Row>(rows: T[], request?: Request) {
    const user = this.currentUser(request);
    if (this.isAdminUser(user)) {
      return rows.filter((row) => this.canAdminAccessOwner(user, String(row.ownerUserId ?? '')));
    }
    const userId = String(user.id ?? '');
    return rows.filter((row) => String(row.ownerUserId ?? '') === userId);
  }

  private userOwnedRows<T extends Row>(rows: T[], userId: string) {
    this.ensureOwnershipBackfill();
    return rows.filter((row) => String(row.ownerUserId ?? '') === userId);
  }

  private ownerSummary(ownerUserId: unknown) {
    const userId = stringValue(ownerUserId);
    const user = userId ? this.db.users.get(userId) : undefined;
    return user ? {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: normalizeRole(user.role),
    } : null;
  }

  private filterRowsByOwnerAndKeyword<T extends Row>(rows: T[], query: Row, fields: string[]) {
    const ownerUserId = stringValue(query.ownerUserId);
    const keyword = stringValue(query.keyword).toLowerCase();
    return rows.filter((row) => {
      if (ownerUserId && String(row.ownerUserId ?? '') !== ownerUserId) return false;
      if (!keyword) return true;
      const haystack = fields
        .map((field) => stringValue(row[field]).toLowerCase())
        .join(' ');
      return haystack.includes(keyword);
    });
  }

  private bodyIds(body: Row, key: string) {
    return Array.isArray(body[key])
      ? (body[key] as unknown[]).map((item) => stringValue(item)).filter(Boolean)
      : [];
  }

  private productDeleteImpactPayload(product: Row) {
    const productId = String(product.id ?? '');
    const devices = [...this.db.labels.values()]
      .filter((label) => String((label as Label & Row).productId ?? '') === productId)
      .map((label) => ({ id: label.id, name: label.title }));
    const tasks = [...this.db.cloudTasks.values()]
      .filter((task) => String(task.productId ?? '') === productId)
      .map((task) => ({ id: task.id, status: task.status }));
    return {
      product: { id: product.id, name: product.name, sku: product.sku },
      devices,
      tasks,
      summary: {
        deviceCount: devices.length,
        taskCount: tasks.length,
      },
    };
  }

  private templateDeleteImpactPayload(template: Row) {
    const templateId = String(template.id ?? '');
    const products = [...this.db.cloudProducts.values()]
      .filter((product) => String(product.defaultTemplateId ?? '') === templateId)
      .map((product) => ({ id: product.id, name: product.name, sku: product.sku }));
    const devices = [...this.db.labels.values()]
      .filter((label) => String((label as Label & Row).templateId ?? '') === templateId)
      .map((label) => ({ id: label.id, name: label.title }));
    const tasks = [...this.db.cloudTasks.values()]
      .filter((task) => String(task.templateId ?? '') === templateId)
      .map((task) => ({ id: task.id, status: task.status }));
    return {
      template: { id: template.id, name: template.name, code: template.code },
      products,
      devices,
      tasks,
      summary: {
        productCount: products.length,
        deviceCount: devices.length,
        taskCount: tasks.length,
      },
    };
  }

  private deviceDeleteImpactPayload(label: Label & Row) {
    const product = label.productId ? this.db.cloudProducts.get(String(label.productId)) : undefined;
    const template = label.templateId ? this.db.cloudTemplates.get(String(label.templateId)) : undefined;
    const ap = label.apId ? this.db.baseStations.get(String(label.apId)) : undefined;
    const tasks = [...this.db.cloudTasks.values()]
      .filter((task) => String(task.eslDeviceId ?? '') === String(label.id))
      .map((task) => ({ id: task.id, status: task.status }));
    return {
      device: { id: label.id, name: label.title },
      product: product ? { id: product.id, name: product.name, sku: product.sku } : null,
      template: template ? { id: template.id, name: template.name, code: template.code } : null,
      ap: ap ? { id: ap.id, name: ap.name } : null,
      tasks,
      summary: {
        hasProduct: Boolean(product),
        hasTemplate: Boolean(template),
        hasAp: Boolean(ap),
        taskCount: tasks.length,
      },
    };
  }

  private ownerUserIdForWrite(body: Row, request?: Request) {
    const user = this.currentUser(request);
    if (this.isAdminUser(user)) {
      const requested = stringValue(body.ownerUserId);
      if (requested && this.db.users.has(requested)) return requested;
    }
    return String(user.id ?? '');
  }

  private localProducts(request?: Request): Row[] {
    return this.visibleRows([...this.db.cloudProducts.values()], request).map((product) => ({
      ...product,
      owner: this.ownerSummary(product.ownerUserId),
      defaultTemplate: product.defaultTemplateId ? this.db.cloudTemplates.get(String(product.defaultTemplateId)) ?? null : null,
      bindDeviceCount: [...this.db.labels.values()].filter((label) => String((label as Label & Row).productId ?? '') === String(product.id ?? '')).length,
    }));
  }

  private localStores(request?: Request) {
    return this.visibleRows([...this.db.stores.values()] as Array<StoreConfig & Row>, request).map((store) => this.localStore(store, request));
  }

  private localStore(store: StoreConfig, request?: Request) {
    const aps = [...this.db.baseStations.values()].filter((ap) => ap.storeCode === store.code && this.canAccessRow(ap as BaseStation & Row, request));
    const labels = [...this.db.labels.values()].filter((label) => label.storeCode === store.code && this.canAccessRow(label as Label & Row, request));
    const onlineAps = aps.filter((ap) => ap.status === 'online' && isRecentActivity(ap.lastSeenAt));
    const { passwordHash: _passwordHash, ...safeStore } = store;
    return {
      ...safeStore,
      address: store.address ?? '',
      owner: this.ownerSummary((store as StoreConfig & Row).ownerUserId),
      apCount: aps.length,
      onlineApCount: onlineAps.length,
      deviceCount: labels.length,
    };
  }

  private localStoreForOwner(store: StoreConfig, ownerUserId: string) {
    const aps = [...this.db.baseStations.values()].filter((ap) => ap.storeCode === store.code && String((ap as BaseStation & Row).ownerUserId ?? '') === ownerUserId);
    const labels = [...this.db.labels.values()].filter((label) => label.storeCode === store.code && String((label as Label & Row).ownerUserId ?? '') === ownerUserId);
    const onlineAps = aps.filter((ap) => ap.status === 'online' && isRecentActivity(ap.lastSeenAt));
    const { passwordHash: _passwordHash, ...safeStore } = store;
    return {
      ...safeStore,
      address: store.address ?? '',
      owner: this.ownerSummary((store as StoreConfig & Row).ownerUserId),
      apCount: aps.length,
      onlineApCount: onlineAps.length,
      deviceCount: labels.length,
    };
  }

  private ensureAdminUser() {
    const existing = [...this.db.users.values()].find((user) => (
      normalizeRole(user.role) === 'ADMIN'
      && String(user.username ?? '') === 'admin'
    ));
    if (existing) return existing;

    const store = [...this.db.stores.values()][0];
    const timestamp = now();
    const user = {
      id: store?.id ?? 'local-admin',
      storeCode: store?.code,
      username: store?.username ?? 'admin',
      displayName: store?.name ?? 'Local ESL Cloud',
      email: '',
      role: 'ADMIN',
      status: 'active',
      passwordHash: store?.passwordHash ?? bcrypt.hashSync('admin123456', 10),
      createdAt: store?.createdAt ?? timestamp,
      updatedAt: store?.updatedAt ?? timestamp,
    };
    this.db.users.set(String(user.id), user);
    return user;
  }

  private ensureOwnershipBackfill() {
    this.ensureAdminUser();
    const snapshot = {
      stores: [...this.db.stores.values()],
      baseStations: [...this.db.baseStations.values()],
      labels: [...this.db.labels.values()],
      cloudProducts: [...this.db.cloudProducts.values()],
      cloudTemplates: [...this.db.cloudTemplates.values()],
      cloudTasks: [...this.db.cloudTasks.values()],
      users: [...this.db.users.values()],
    };
    const before = ownershipFingerprint(snapshot);
    migrateLegacyOwners(snapshot);
    const after = ownershipFingerprint(snapshot);
    if (before !== after) {
      this.db.save();
    }
  }


  private findLoginUser(storeCode: unknown, username: string, required = true) {
    this.ensureAdminUser();
    const user = [...this.db.users.values()].find((item) => (
      String(item.username ?? '') === username
      && (!storeCode || String(item.storeCode ?? '') === String(storeCode))
    ));
    if (!user && required) throw new NotFoundException('User not found');
    return user;
  }

  private findUser(userId: string) {
    this.ensureAdminUser();
    const user = this.db.users.get(userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private localUser(user: Row) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      role: normalizeRole(user.role),
      status: stringValue(user.status, 'active'),
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }

  private findInviteByToken(token: string) {
    const invite = [...this.db.userInvites.values()].find((item) => String(item.token ?? '') === token);
    if (!invite) throw new NotFoundException('Invite not found');
    return invite;
  }

  private assertInviteUsable(invite: Row) {
    if (invite.revokedAt) throw new BadRequestException('Invite has been revoked');
    if (invite.usedAt) throw new BadRequestException('Invite has already been used');
    const expiresAt = new Date(String(invite.expiresAt ?? '')).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new BadRequestException('Invite has expired');
    }
  }

  private publicInvite(invite: Row) {
    return {
      username: invite.username,
      displayName: invite.displayName,
      email: invite.email,
      role: normalizeRole(invite.role),
      expiresAt: invite.expiresAt,
    };
  }

  private localInvite(invite: Row) {
    return {
      id: invite.id,
      token: invite.token,
      username: invite.username,
      displayName: invite.displayName,
      email: invite.email,
      role: normalizeRole(invite.role),
      expiresAt: invite.expiresAt,
      usedAt: invite.usedAt ?? null,
      revokedAt: invite.revokedAt ?? null,
      createdByUserId: invite.createdByUserId ?? null,
      createdAt: invite.createdAt,
      registerPath: `/register?token=${invite.token}`,
    };
  }

  private addAuditLog(moduleName: string, action: string, targetId: unknown, beforeJson: unknown, afterJson: unknown) {
    this.db.auditLogs.unshift({
      id: id('audit'),
      module: moduleName,
      action,
      targetId: targetId == null ? null : String(targetId),
      operatorId: this.ensureAdminUser().id,
      beforeJson,
      afterJson,
      createdAt: now(),
    });
    this.db.auditLogs.splice(1000);
  }

  private localDevices(request?: Request): LocalDevice[] {
    return this.visibleRows([...this.db.labels.values()] as Array<Label & Row>, request).map((label) => this.localDevice(label, true, request, true));
  }

  private visibleDeviceLabels(request?: Request) {
    return this.visibleRows([...this.db.labels.values()] as Array<Label & Row>, request);
  }

  private filterDeviceLabels(labels: Array<Label & Row>, query: Row, request?: Request) {
    const storeCode = stringValue(query.storeCode);
    const apId = stringValue(query.apId);
    const ownerUserId = stringValue(query.ownerUserId);
    const productId = stringValue(query.productId);
    const templateId = stringValue(query.templateId);
    const group = stringValue(query.group);
    const keyword = stringValue(query.keyword).toLowerCase();
    return labels.filter((label) => {
      const ap = label.apId ? this.findAp(String(label.apId), false) : undefined;
      if (ap && !this.canAccessRow(ap as unknown as Row, request)) return false;
      if (ownerUserId && String(label.ownerUserId ?? '') !== ownerUserId) return false;
      if (storeCode && label.storeCode !== storeCode && ap?.storeCode !== storeCode) return false;
      if (apId && label.apId !== apId) return false;
      if (productId && String(label.productId ?? '') !== productId) return false;
      if (templateId && String(label.templateId ?? '') !== templateId) return false;
      if (group && stringValue(label.group) !== group) return false;
      if (!keyword) return true;
      const haystack = [
        label.id,
        label.title,
        label.status,
        label.storeCode,
        label.sku,
        label.productId,
        label.templateId,
        label.group,
        ap?.name,
        ap?.id,
      ].map((item) => stringValue(item).toLowerCase()).join(' ');
      return haystack.includes(keyword);
    });
  }

  private filterDevices(devices: LocalDevice[], query: Row, request?: Request) {
    const storeCode = stringValue(query.storeCode);
    const apId = stringValue(query.apId);
    const ownerUserId = stringValue(query.ownerUserId);
    const keyword = stringValue(query.keyword).toLowerCase();
    return devices.filter((device) => {
      const ap = device.apId ? this.findAp(String(device.apId), false) : undefined;
      if (ap && !this.canAccessRow(ap as unknown as Row, request)) return false;
      if (ownerUserId && String(device.ownerUserId ?? '') !== ownerUserId) return false;
      if (storeCode && device.storeCode !== storeCode && ap?.storeCode !== storeCode) return false;
      if (apId && device.apId !== apId) return false;
      if (keyword) {
        const haystack = [
          device.id,
          device.eslCode,
          device.name,
          device.deviceType,
          device.status,
          ap?.name,
          ap?.id,
        ].map((item) => stringValue(item).toLowerCase()).join(' ');
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
  }

  private localDeviceListItem(label: Label & Row, request?: Request): LocalDevice {
    const storedProduct = label.productId ? this.db.cloudProducts.get(String(label.productId)) as Row | undefined : undefined;
    const storedTemplate = label.templateId ? this.db.cloudTemplates.get(String(label.templateId)) as Row | undefined : undefined;
    const product = storedProduct && this.canAccessRow(storedProduct, request)
      ? storedProduct
      : null;
    const template = storedTemplate && this.canAccessRow(storedTemplate, request)
      ? storedTemplate
      : null;
    const ap = label.apId ? this.findAp(String(label.apId), false) : undefined;
    const preset = this.resolveDevicePreset(stringValue(label.deviceType), template, label.id);
    const status = this.effectiveLabelStatus(label);
    return {
      id: label.id,
      eslCode: label.id,
      storeCode: label.storeCode,
      storeName: this.db.stores.get(label.storeCode)?.name ?? label.storeCode,
      name: label.title,
      ownerUserId: label.ownerUserId,
      owner: this.ownerSummary(label.ownerUserId),
      apId: label.apId,
      productId: label.productId,
      templateId: label.templateId,
      deviceType: stringValue(label.deviceType, stringValue(template?.deviceType, preset.deviceType)),
      screenWidth: numberValue(label.screenWidth, numberValue(template?.width, preset.width)),
      screenHeight: numberValue(label.screenHeight, numberValue(template?.height, preset.height)),
      battery: label.battery ?? 100,
      signal: label.rssi ?? 0,
      group: stringValue(label.group) || undefined,
      bindStatus: label.productId || label.templateId ? 'bound' : 'unbound',
      status,
      lastRefreshAt: label.updatedAt,
      createdAt: label.updatedAt,
      updatedAt: label.updatedAt,
      product: product ? {
        id: product.id,
        name: product.name,
        sku: product.sku,
        ownerUserId: product.ownerUserId,
        owner: this.ownerSummary(product.ownerUserId),
      } : null,
      template: template ? {
        id: template.id,
        name: template.name,
        code: template.code,
        deviceType: template.deviceType,
        width: template.width,
        height: template.height,
        ownerUserId: template.ownerUserId,
        owner: this.ownerSummary(template.ownerUserId),
      } : null,
      ap: ap && this.canAccessRow(ap as unknown as Row, request) ? this.localApSummary(ap) : null,
    };
  }

  private localTask(task: Row, includeDetail = false) {
    const delivery = task.delivery && typeof task.delivery === 'object' ? task.delivery as Row : {};
    const protocol = delivery.protocol && typeof delivery.protocol === 'object' ? delivery.protocol as Row : undefined;
    const websocket = delivery.websocket && typeof delivery.websocket === 'object' ? delivery.websocket as Row : undefined;
    const downlinkTrace = delivery.downlinkTrace && typeof delivery.downlinkTrace === 'object' ? delivery.downlinkTrace as Row : undefined;
    const renderResult = task.renderResult && typeof task.renderResult === 'object' ? task.renderResult as Row : {};
    const base = {
      id: task.id,
      taskType: task.taskType,
      eslDeviceId: task.eslDeviceId,
      apId: task.apId,
      productId: task.productId,
      templateId: task.templateId,
      ownerUserId: task.ownerUserId,
      owner: this.ownerSummary(task.ownerUserId),
      payload: task.payload,
      renderResult: {
        width: renderResult.width,
        height: renderResult.height,
        colorMode: renderResult.colorMode,
        previewImageUrl: includeDetail ? renderResult.previewImageUrl : undefined,
      },
      retryCount: this.manualRetryCount(task),
      status: task.status,
      parentTaskId: task.parentTaskId,
      triggeredAt: task.triggeredAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      userMessage: this.taskUserMessage(task),
      resultMsg: task.resultMsg,
      delivery: includeDetail ? {
        ok: delivery.ok,
        reason: delivery.reason,
        commandId: delivery.commandId,
        transport: delivery.transport,
        websocket: websocket ? {
          ok: websocket.ok,
          trackingId: websocket.trackingId,
          reason: websocket.reason,
        } : undefined,
        mqtt: delivery.mqtt,
        protocol,
        downlinkTrace: downlinkTrace ? {
          id: downlinkTrace.id,
          status: downlinkTrace.status,
          updatedAt: downlinkTrace.updatedAt,
          commandType: downlinkTrace.commandType,
          labelId: downlinkTrace.labelId,
          queueId: downlinkTrace.queueId,
          error: downlinkTrace.error,
        } : undefined,
      } : undefined,
    };
    if (!includeDetail) {
      return base;
    }
    return {
      ...base,
      events: Array.isArray(task.events) ? task.events : [],
      eslDevice: task.eslDevice && typeof task.eslDevice === 'object'
        ? {
          id: (task.eslDevice as Row).id,
          eslCode: (task.eslDevice as Row).eslCode,
          name: (task.eslDevice as Row).name,
          apId: (task.eslDevice as Row).apId,
          productId: (task.eslDevice as Row).productId,
          templateId: (task.eslDevice as Row).templateId,
          status: (task.eslDevice as Row).status,
        }
        : undefined,
    };
  }

  private localTaskListItem(task: Row) {
    const eslDevice = task.eslDevice && typeof task.eslDevice === 'object' ? task.eslDevice as Row : undefined;
    const product = task.productId ? this.db.cloudProducts.get(String(task.productId)) : undefined;
    const ap = task.apId ? this.db.baseStations.get(String(task.apId)) : undefined;
    return {
      ...this.localTask(task, false),
      payload: undefined,
      delivery: undefined,
      renderResult: undefined,
      eslDevice: eslDevice ? {
        id: eslDevice.id,
        eslCode: eslDevice.eslCode,
        name: eslDevice.name,
        apId: eslDevice.apId,
        productId: eslDevice.productId,
        templateId: eslDevice.templateId,
        status: eslDevice.status,
      } : task.eslDeviceId ? { id: task.eslDeviceId, eslCode: task.eslDeviceId } : undefined,
      product: product ? { id: product.id, name: product.name, sku: product.sku } : undefined,
      ap: ap ? this.localApSummary(ap) : undefined,
    };
  }

  private taskUserMessage(task: Row) {
    const status = stringValue(task.status).toLowerCase();
    const taskType = stringValue(task.taskType);
    const result = stringValue(task.resultMsg);

    if (status === 'success') {
      if (taskType === 'auto_retry_after_wake') return '补发任务已完成。';
      return '刷新已完成。';
    }
    if (status === 'skipped' || status === 'superseded' || status === 'cancelled') {
      if (result.includes('父任务已确认执行成功')) return '主任务已成功，这次补发已自动取消。';
      return '任务已取消。';
    }
    if (status === 'queued') return '任务已提交，正在排队。';
    if (status === 'trigger_pending') return '标签未确认真实在线，待触发重试中。';
    if (status === 'rendering') return '正在生成价签画面。';
    if (status === 'sending') {
      if (taskType === 'auto_retry_after_wake') return '正在补发刷新，请稍等。';
      if (result.includes('自动唤醒') || result.includes('重新唤醒') || result.includes('重新下发')) return '后台正在唤醒价签并重试刷新。';
      return '已发送到基站，正在等待结果。';
    }
    if (status === 'timeout') return '等待基站确认超时，请稍后重试。';
    if (status === 'failed') {
      if (result.includes('没有在线基站') || result.includes('没有可用基站')) return '没有可用基站，刷新未发送。';
      if (result.includes('WebSocket 不可用') || result.includes('MQTT 发布失败')) return '基站连接不可用，刷新未发送。';
      if (result.includes('标签不存在')) return '标签不存在，任务无法继续。';
      if (result.includes('设备执行失败')) return '价签返回失败，请重试。';
      if (result.includes('已自动唤醒并重试')) return '多次自动重试后仍未成功。';
      return '任务失败，请重试。';
    }
    return result ? '任务状态已更新。' : '等待处理。';
  }

  private localDevice(label: Label, includeAp = true, request?: Request, compactAp = false): LocalDevice {
    const row = label as Label & Row;
    const product = row.productId
      ? this.visibleRows([...this.db.cloudProducts.values()], request).map((item): Row => ({
        ...item,
        owner: this.ownerSummary(item.ownerUserId),
      })).find((item) => item.id === row.productId) ?? null
      : null;
    const template = row.templateId
      ? this.visibleRows([...this.db.cloudTemplates.values()], request).map((item) => this.localTemplate(item, request)).find((item) => item.id === row.templateId) ?? null
      : null;
    const ap = includeAp && label.apId ? this.findAp(label.apId, false) : undefined;
    const preset = this.resolveDevicePreset(stringValue(row.deviceType), template, label.id);
    const status = this.effectiveLabelStatus(label);
    return {
      id: label.id,
      eslCode: label.id,
      storeCode: label.storeCode,
      storeName: this.db.stores.get(label.storeCode)?.name ?? label.storeCode,
      name: label.title,
      ownerUserId: (label as Label & Row).ownerUserId,
      owner: this.ownerSummary((label as Label & Row).ownerUserId),
      apId: label.apId,
      productId: row.productId,
      templateId: row.templateId,
      deviceType: stringValue(row.deviceType, stringValue(template?.deviceType, preset.deviceType)),
      screenWidth: numberValue(row.screenWidth, numberValue(template?.width, preset.width)),
      screenHeight: numberValue(row.screenHeight, numberValue(template?.height, preset.height)),
      battery: label.battery ?? 100,
      signal: label.rssi ?? 0,
      group: stringValue(row.group) || undefined,
      bindStatus: row.productId || row.templateId ? 'bound' : 'unbound',
      status,
      lastRefreshAt: label.updatedAt,
      createdAt: label.updatedAt,
      updatedAt: label.updatedAt,
      product,
      template,
      ap: includeAp && ap && this.canAccessRow(ap as unknown as Row, request)
        ? (compactAp ? this.localApSummary(ap) : this.localAp(ap, request))
        : null,
    };
  }

  private effectiveLabelStatus(label: Label): Label['status'] {
    if (label.status === 'idle') return 'idle';
    if (label.status === 'updating') return 'updating';
    if (label.status === 'failed') return 'failed';
    const ap = label.apId ? this.db.baseStations.get(String(label.apId)) : undefined;
    const apOnline = Boolean(ap && ap.status === 'online' && isRecentActivity(ap.lastSeenAt));
    if (!apOnline) {
      return isWithinMs(label.updatedAt, LABEL_OFFLINE_AFTER_MS) && label.status === 'online' ? 'online' : 'offline';
    }
    const row = label as Label & Row;
    const connectivity = row.connectivity && typeof row.connectivity === 'object' ? row.connectivity as Row : {};
    if (label.status === 'online' && stringValue(connectivity.state) === 'online' && isWithinMs(connectivity.checkedAt, LABEL_ONLINE_STABLE_MS)) {
      return 'online';
    }
    const apOnlineAt = ap && typeof ap.onlineAt === 'string'
      ? stringValue(ap.onlineAt)
      : stringValue(ap?.lastSeenAt);
    const apJustOnline = apOnlineAt ? isWithinMs(apOnlineAt, AP_ONLINE_LABEL_TRUST_DELAY_MS) : false;
    const scanned = this.isLabelScannedByAp(label, label.apId, LABEL_ONLINE_STABLE_MS);
    if (label.status === 'offline') {
      return scanned ? 'online' : 'offline';
    }
    if (apJustOnline && !scanned && !this.hasRecentVerifiedLabelContact(label, LABEL_ONLINE_STABLE_MS)) {
      return 'offline';
    }
    return this.hasRecentVerifiedLabelContact(label, LABEL_ONLINE_STABLE_MS) ? 'online' : 'offline';
  }

  private localApSummary(ap: BaseStation) {
    const row = ap as BaseStation & Row;
    const online = ap.status === 'online' && isRecentActivity(ap.lastSeenAt);
    return {
      id: ap.id,
      apCode: ap.id,
      storeCode: ap.storeCode,
      storeName: this.db.stores.get(ap.storeCode)?.name ?? ap.storeCode,
      name: ap.name,
      ownerUserId: row.ownerUserId,
      owner: this.ownerSummary(row.ownerUserId),
      status: online ? 'online' : 'offline',
      online,
      lastOnlineAt: ap.lastSeenAt,
    };
  }

  private localAps(request?: Request): LocalAp[] {
    return this.visibleRows([...this.db.baseStations.values()] as Array<BaseStation & Row>, request).map((ap) => this.localAp(ap, request, false));
  }

  private filterAps(aps: LocalAp[], query: Row) {
    const storeCode = stringValue(query.storeCode);
    const ownerUserId = stringValue(query.ownerUserId);
    const keyword = stringValue(query.keyword).toLowerCase();
    return aps.filter((ap) => {
      if (storeCode && ap.storeCode !== storeCode) return false;
      if (ownerUserId && String(ap.ownerUserId ?? '') !== ownerUserId) return false;
      if (!keyword) return true;
      const haystack = [ap.id, ap.apCode, ap.name, ap.storeCode, ap.storeName, ap.status]
        .map((item) => stringValue(item).toLowerCase())
        .join(' ');
      return haystack.includes(keyword);
    });
  }

  private resolveDevicePreset(deviceType?: string, template?: Row | null, labelId?: string) {
    const normalized = stringValue(deviceType).toUpperCase();
    const byType: Record<string, { deviceType: string; width: number; height: number }> = {
      ET0154: { deviceType: 'ET0154-80', width: 200, height: 200 },
      'ET0154-80': { deviceType: 'ET0154-80', width: 200, height: 200 },
      ET0213: { deviceType: 'ET0213-81', width: 250, height: 122 },
      'ET0213-81': { deviceType: 'ET0213-81', width: 250, height: 122 },
      ET0266: { deviceType: 'ET0266-82', width: 296, height: 152 },
      'ET0266-82': { deviceType: 'ET0266-82', width: 296, height: 152 },
      'ESL-03-02-152X296': { deviceType: 'ESL-03-02-152X296', width: 152, height: 296 },
      'ESL-03-02-128X296': { deviceType: 'ESL-03-02-128X296', width: 128, height: 296 },
      'ESL-03-04-240X416': { deviceType: 'ESL-03-04-240X416', width: 240, height: 416 },
      'ESL-03-03-184X384': { deviceType: 'ESL-03-03-184X384', width: 184, height: 384 },
      'ESL-03-128X250': { deviceType: 'ESL-03-128X250', width: 128, height: 250 },
      'ESL-03-02-200X200': { deviceType: 'ESL-03-02-200X200', width: 200, height: 200 },
      ET0290: { deviceType: 'ET0290-84', width: 296, height: 128 },
      'ET0290-84': { deviceType: 'ET0290-84', width: 296, height: 128 },
      ET0420: { deviceType: 'ET0420-87', width: 400, height: 300 },
      'ET0420-87': { deviceType: 'ET0420-87', width: 400, height: 300 },
      'ESL-03-04-400X300': { deviceType: 'ESL-03-04-400X300', width: 400, height: 300 },
      ET0580: { deviceType: 'ET0580-88', width: 648, height: 480 },
      'ET0580-88': { deviceType: 'ET0580-88', width: 648, height: 480 },
      'ESL-03-0A-648X480': { deviceType: 'ESL-03-0A-648X480', width: 648, height: 480 },
      ET0750: { deviceType: 'ET0750-89', width: 800, height: 480 },
      'ET0750-89': { deviceType: 'ET0750-89', width: 800, height: 480 },
      'ESL-0C-800X480': { deviceType: 'ESL-0C-800X480', width: 800, height: 480 },
    };
    const normalizedLabelId = stringValue(labelId).toLowerCase();
    const explicitKey = LABEL_PRESET_KEYS[normalizedLabelId]
      ?? LABEL_PREFIX_PRESET_KEYS.find((item) => normalizedLabelId.startsWith(item.prefix))?.key;
    const explicit = explicitKey ? SCREEN_PRESETS.find((preset) => preset.key === explicitKey) : undefined;
    if (explicit) {
      const width = Math.max(explicit.width, explicit.height);
      const height = Math.min(explicit.width, explicit.height);
      return {
        deviceType: `ESL-${explicit.mode.split('#')[0].replace(/\s+/g, '-').toUpperCase()}`,
        width,
        height,
      };
    }
    return byType[normalized] ?? {
      deviceType: stringValue(template?.deviceType, 'KERSEN_296_128'),
      width: numberValue(template?.width, 296),
      height: numberValue(template?.height, 128),
    };
  }

  private localAp(ap: BaseStation, request?: Request, includeDetail?: boolean): LocalAp;
  private localAp(ap?: BaseStation, request?: Request, includeDetail?: boolean): LocalAp | null;
  private localAp(ap?: BaseStation, request?: Request, includeDetail = true): LocalAp | null {
    if (!ap) return null;
    const row = ap as BaseStation & Row;
    const deviceLabels = [...this.db.labels.values()]
      .filter((label) => label.apId === ap.id && this.canAccessRow(label as Label & Row, request)) as Array<Label & Row>;
    const devices = includeDetail
      ? deviceLabels.slice(0, 200).map((label) => this.localDeviceListItem(label, request))
      : [];
    const boundDeviceCount = deviceLabels.filter((label) => label.productId || label.templateId).length;
    const discoveredLabels = ap.discoveredLabels ?? {};
    const discoveredDevices = Object.values(discoveredLabels).map((item) => ({
      eslCode: item.eslCode,
      status: item.status,
      battery: item.battery,
      signal: item.signal,
      lastSeenAt: item.lastSeenAt,
      source: item.source,
    }));
    const latestHeartbeat = ap.lastSeenAt ?? now();
    const online = ap.status === 'online' && isRecentActivity(ap.lastSeenAt);
    const config = row.config && typeof row.config === 'object' ? row.config as Row : {};
    return {
      id: ap.id,
      apCode: ap.id,
      storeCode: ap.storeCode,
      storeName: this.db.stores.get(ap.storeCode)?.name ?? ap.storeCode,
      ownerUserId: row.ownerUserId,
      owner: this.ownerSummary(row.ownerUserId),
      name: ap.name,
      ip: ap.ip,
      mac: ap.mac,
      firmwareVersion: ap.firmware,
      location: row.location,
      config: {
        ...config,
        autoImportScannedLabels: config.autoImportScannedLabels === true,
      },
      status: online ? 'online' : 'offline',
      online,
      lastOnlineAt: ap.lastSeenAt,
      lastHeartbeatAt: latestHeartbeat,
      heartbeatIntervalSeconds: Number(process.env.AP_OFFLINE_AFTER_SECONDS ?? 90),
      deviceCount: deviceLabels.length,
      boundDeviceCount,
      discoveredDeviceCount: discoveredDevices.length,
      devices,
      boundDevices: includeDetail ? devices.filter((item) => item.bindStatus === 'bound') : [],
      discoveredDevices: includeDetail ? discoveredDevices.slice(0, 200) : [],
      recentHeartbeats: includeDetail ? [{
        id: `${ap.id}-latest`,
        createdAt: latestHeartbeat,
        status: online ? 'online' : 'offline',
        payloadJson: { ip: ap.ip, firmware: ap.firmware, hostAddr: ap.hostAddr },
      }] : [],
      recentTasks: includeDetail ? [...this.db.cloudTasks.values()]
        .filter((item) => item.apId === ap.id && this.canAccessRow(item as Row, request))
        .slice(0, 10)
        .map((item) => this.localTask(item, false)) : [],
      recentLogs: includeDetail ? this.recentApLogs(ap) : [],
      createdAt: ap.lastSeenAt ?? now(),
      updatedAt: ap.lastSeenAt ?? now(),
    };
  }

  private localApForOwner(ap: BaseStation, ownerUserId: string): LocalAp {
    const row = ap as BaseStation & Row;
    const devices = [...this.db.labels.values()]
      .filter((label) => label.apId === ap.id && String((label as Label & Row).ownerUserId ?? '') === ownerUserId)
      .map((label) => this.localDeviceForOwner(label));
    const discoveredLabels = ap.discoveredLabels ?? {};
    const discoveredDevices = Object.values(discoveredLabels).map((item) => ({
      eslCode: item.eslCode,
      status: item.status,
      battery: item.battery,
      signal: item.signal,
      lastSeenAt: item.lastSeenAt,
      source: item.source,
    }));
    const latestHeartbeat = ap.lastSeenAt ?? now();
    const online = ap.status === 'online' && isRecentActivity(ap.lastSeenAt);
    const config = row.config && typeof row.config === 'object' ? row.config as Row : {};
    return {
      id: ap.id,
      apCode: ap.id,
      storeCode: ap.storeCode,
      storeName: this.db.stores.get(ap.storeCode)?.name ?? ap.storeCode,
      ownerUserId: row.ownerUserId,
      owner: this.ownerSummary(row.ownerUserId),
      name: ap.name,
      ip: ap.ip,
      mac: ap.mac,
      firmwareVersion: ap.firmware,
      location: row.location,
      config: {
        ...config,
        autoImportScannedLabels: config.autoImportScannedLabels === true,
      },
      status: online ? 'online' : 'offline',
      online,
      lastOnlineAt: ap.lastSeenAt,
      lastHeartbeatAt: latestHeartbeat,
      heartbeatIntervalSeconds: Number(process.env.AP_OFFLINE_AFTER_SECONDS ?? 90),
      deviceCount: devices.length,
      discoveredDeviceCount: discoveredDevices.length,
      devices,
      boundDevices: devices.filter((item) => item.bindStatus === 'bound'),
      discoveredDevices,
      recentHeartbeats: [{
        id: `${ap.id}-latest`,
        createdAt: latestHeartbeat,
        status: online ? 'online' : 'offline',
        payloadJson: { ip: ap.ip, firmware: ap.firmware, hostAddr: ap.hostAddr },
      }],
      recentTasks: [...this.db.cloudTasks.values()]
        .filter((item) => item.apId === ap.id && String(item.ownerUserId ?? '') === ownerUserId)
        .slice(0, 10)
        .map((item) => this.localTask(item, false)),
      recentLogs: this.recentApLogs(ap),
      createdAt: ap.lastSeenAt ?? now(),
      updatedAt: ap.lastSeenAt ?? now(),
    };
  }

  private localDeviceForOwner(label: Label): LocalDevice {
    const device = this.localDevice(label, false);
    delete device.product;
    delete device.template;
    delete device.ap;
    return device;
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

  private findProduct(productId: string): Row {
    const product = this.db.cloudProducts.get(productId);
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private findTemplate(templateId: string): Row {
    this.ensureDefaultTemplate();
    const template = this.db.cloudTemplates.get(templateId);
    if (!template) throw new NotFoundException('Template not found');
    return this.localTemplate(template);
  }

  private isDefaultTemplateDeleted() {
    return existsSync(join(getUploadDir(), DEFAULT_TEMPLATE_DELETED_MARKER));
  }

  private async markDefaultTemplateDeleted() {
    await fs.mkdir(getUploadDir(), { recursive: true });
    await fs.writeFile(join(getUploadDir(), DEFAULT_TEMPLATE_DELETED_MARKER), now());
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

  private deleteStoreReferences(storeCode: string) {
    const removedApIds = new Set<string>();
    for (const [apId, ap] of this.db.baseStations.entries()) {
      if (ap.storeCode === storeCode) {
        removedApIds.add(apId);
        this.db.baseStations.delete(apId);
      }
    }
    for (const label of this.db.labels.values()) {
      if (label.storeCode === storeCode) {
        label.storeCode = '';
      }
      const row = label as Label & Row;
      if (row.apId && removedApIds.has(String(row.apId))) {
        delete row.apId;
      }
    }
    for (const product of this.db.cloudProducts.values()) {
      if (String(product.storeCode ?? '') === storeCode) {
        delete product.storeCode;
      }
    }
    for (const template of this.db.cloudTemplates.values()) {
      if (String(template.storeCode ?? '') === storeCode) {
        delete template.storeCode;
      }
    }
    for (const task of this.db.cloudTasks.values()) {
      if (String(task.storeCode ?? '') === storeCode) {
        delete task.storeCode;
      }
      if (task.apId && removedApIds.has(String(task.apId))) {
        delete task.apId;
      }
    }
  }

  private repointStoreReferences(fromStoreCode: string, toStoreCode: string) {
    for (const ap of this.db.baseStations.values()) {
      if (ap.storeCode === fromStoreCode) ap.storeCode = toStoreCode;
    }
    for (const label of this.db.labels.values()) {
      if (label.storeCode === fromStoreCode) label.storeCode = toStoreCode;
    }
    for (const product of this.db.cloudProducts.values()) {
      if (String(product.storeCode ?? '') === fromStoreCode) product.storeCode = toStoreCode;
    }
    for (const template of this.db.cloudTemplates.values()) {
      if (String(template.storeCode ?? '') === fromStoreCode) template.storeCode = toStoreCode;
    }
    for (const task of this.db.cloudTasks.values()) {
      if (String(task.storeCode ?? '') === fromStoreCode) task.storeCode = toStoreCode;
    }
  }

  private findApByMac(mac: string, exceptId?: string) {
    const normalized = normalizeMacValue(mac);
    return [...this.db.baseStations.values()].find((ap) => (
      ap.id !== exceptId
      && normalizeMacValue(ap.mac) === normalized
    ));
  }

  private renameApId(apId: string, nextApId: string) {
    const current = this.findAp(apId) as BaseStation & Row;
    const target = this.db.baseStations.get(nextApId) as BaseStation & Row | undefined;
    if (target && target.id !== current.id) {
      const merged: BaseStation & Row = {
        ...current,
        ...target,
        id: nextApId,
        name: target.name || current.name,
        mac: target.mac || current.mac,
        ip: target.ip || current.ip,
        firmware: target.firmware || current.firmware,
        location: target.location ?? current.location,
        config: {
          ...(current.config && typeof current.config === 'object' ? current.config as Row : {}),
          ...(target.config && typeof target.config === 'object' ? target.config as Row : {}),
        },
        discoveredLabels: {
          ...(current.discoveredLabels ?? {}),
          ...(target.discoveredLabels ?? {}),
        },
        metrics: {
          ...(current.metrics ?? {}),
          ...(target.metrics ?? {}),
        },
        lastSeenAt: target.lastSeenAt ?? current.lastSeenAt,
        status: target.status === 'online' ? target.status : current.status,
      };
      this.db.baseStations.set(nextApId, merged);
      this.db.baseStations.delete(apId);
      this.repointApReferences(apId, nextApId);
      return merged;
    }

    this.db.baseStations.delete(apId);
    const renamed = { ...current, id: nextApId };
    this.db.baseStations.set(nextApId, renamed);
    this.repointApReferences(apId, nextApId);
    return renamed;
  }

  private repointApReferences(fromApId: string, toApId: string) {
    for (const label of this.db.labels.values()) {
      if (label.apId === fromApId) {
        label.apId = toApId;
      }
    }
    for (const task of this.db.cloudTasks.values()) {
      if (task.apId === fromApId) {
        task.apId = toApId;
      }
    }
  }

  private recentApLogs(ap: BaseStation) {
    const ids = new Set([ap.id, ap.mac].map((item) => stringValue(item)).filter(Boolean));
    return this.db.requestLogs
      .filter((log) => {
        if (log.method === 'WS' || log.method === 'WS-UPGRADE') {
          return ids.size === 0 || [...ids].some((idValue) => JSON.stringify(log.body ?? {}).includes(idValue));
        }
        if (String(log.path).startsWith('/api/websocket')) {
          return true;
        }
        if (String(log.path).startsWith(`/api/v1/aps/${ap.id}`)) {
          return true;
        }
        return false;
      })
      .slice(0, 80);
  }
}
