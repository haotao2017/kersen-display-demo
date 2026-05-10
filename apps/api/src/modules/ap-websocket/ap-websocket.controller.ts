import { Body, Controller, Get, HttpCode, Logger, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { MemoryStore } from '../../shared/memory-store';
import { BaseStation } from '../../shared/models';

type ApAuthBody = {
  auth_type?: string;
  user?: string;
  username?: string;
  password?: string;
  mac?: string;
  ap_code?: string;
  apCode?: string;
  store_code?: string;
  storeCode?: string;
};

function decodeBase64(value?: unknown) {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    return '';
  }
  const decoded = Buffer.from(normalized, 'base64').toString('utf8');
  if (!decoded || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(decoded)) {
    return '';
  }
  return decoded;
}

function credentialValue(encoded?: unknown, plain?: unknown) {
  const decoded = decodeBase64(encoded);
  if (decoded) {
    return decoded;
  }
  return typeof plain === 'string' ? plain : '';
}

function normalizeMac(value?: string) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  const hex = raw.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  if (hex.length !== 12) {
    return raw.toLowerCase();
  }
  return hex.match(/.{1,2}/g)?.join(':') ?? raw.toLowerCase();
}

function passwordMatches(password: string, passwordHash: string) {
  try {
    return bcrypt.compareSync(password, passwordHash);
  } catch {
    return false;
  }
}

function makeLegacyToken(storeCode: string, apId: string) {
  return createHash('sha256')
    .update(`${storeCode}:${apId}:${Date.now()}:${Math.random()}`)
    .digest('hex');
}

@Controller('api/websocket')
export class ApWebsocketController {
  private readonly logger = new Logger(ApWebsocketController.name);

  constructor(private readonly db: MemoryStore) {}

  @Post('auth')
  @HttpCode(200)
  async auth(@Body() body: ApAuthBody, @Req() request: Request) {
    return this.authenticate(body, request);
  }

  @Get('auth')
  authProbe(@Query() query: ApAuthBody, @Req() request: Request) {
    if (!query.user && !query.username && !query.password) {
      return {
        ok: true,
        service: 'kersen-esl-ap-auth',
        method: 'POST',
        note: 'AP devices should authenticate with POST. Query parameters are accepted for diagnostics only.',
      };
    }
    return this.authenticate(query, request);
  }

  private authenticate(body: ApAuthBody, request: Request) {
    const username = credentialValue(body.user, body.username);
    const passwordPayload = credentialValue(body.password, body.password);
    const [password] = passwordPayload.split('||');
    const mac = normalizeMac(body.mac || body.ap_code || body.apCode || passwordPayload.split('||')[1]);
    const requestedStoreCode = String(body.store_code ?? body.storeCode ?? '').trim();
    const fallbackStore = [...this.db.stores.values()][0];
    const storeCode = requestedStoreCode || fallbackStore?.code || process.env.UPSTREAM_STORE_CODE || '20248517';
    const store = this.db.stores.get(storeCode);
    const matchedAp = this.findRegisteredAp(storeCode, mac) ?? this.findRegisteredAp('', mac);
    const apId = matchedAp?.id || mac || `ap-${storeCode}`;
    const authTypeOk = !body.auth_type || body.auth_type === 'ap';

    if (!store || username !== store.username || !passwordMatches(password, store.passwordHash) || !authTypeOk) {
      this.logger.warn(
        `AP auth failed: store=${storeCode || '-'} user=${username || '-'} mac=${mac || '-'} authType=${body.auth_type || '-'} ip=${request.ip}`,
      );
      throw new UnauthorizedException({
        code: 401,
        msg: 'ap auth failed',
      });
    }

    this.rememberApAuth(apId, storeCode, mac, request);
    const token = makeLegacyToken(storeCode, apId);
    this.db.registerApSession(token, storeCode, apId, 'local');
    return { token };
  }

  private rememberApAuth(apId: string, storeCode: string, mac: string | undefined, request: Request) {
    const current = this.db.baseStations.get(apId);
    const ap: BaseStation = {
      id: apId,
      storeCode,
      name: current?.name ?? `AP ${apId}`,
      mac: mac || current?.mac,
      ip: request.ip,
      firmware: current?.firmware ?? 'unknown',
      os: current?.os,
      hostAddr: current?.hostAddr,
      channels: current?.channels,
      location: current?.location,
      config: current?.config ?? {},
      discoveredLabels: current?.discoveredLabels ?? {},
      status: current?.status ?? 'offline',
      lastSeenAt: current?.lastSeenAt,
      metrics: current?.metrics ?? {},
    };

    this.db.baseStations.set(ap.id, ap);
    this.db.save();
  }

  private findRegisteredAp(storeCode: string, mac?: string) {
    if (!mac) {
      return undefined;
    }
    return [...this.db.baseStations.values()].find((ap) => (
      normalizeMac(ap.mac) === mac
      && (!storeCode || ap.storeCode === storeCode)
    ));
  }

}
