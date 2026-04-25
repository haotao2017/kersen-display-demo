import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'node:crypto';
import { MemoryStore } from '../../shared/memory-store';
import { BaseStation } from '../../shared/models';
import { loadEnvFiles } from '../../shared/load-env';

type ApAuthBody = {
  auth_type?: string;
  user?: string;
  password?: string;
  mac?: string;
  store_code?: string;
};

function decodeBase64(value?: string) {
  if (!value) {
    return '';
  }
  return Buffer.from(value, 'base64').toString('utf8');
}

function makeLegacyToken(storeCode: string, apId: string) {
  return createHash('sha256')
    .update(`${storeCode}:${apId}:${Date.now()}:${Math.random()}`)
    .digest('hex');
}

function encodeBase64(value: string) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function proxyOfficialEnabled() {
  loadEnvFiles();
  return process.env.AP_PROXY_OFFICIAL === 'true';
}

@Controller('api/websocket')
export class ApWebsocketController {
  constructor(private readonly db: MemoryStore) {}

  @Post('auth')
  @HttpCode(200)
  async auth(@Body() body: ApAuthBody, @Req() request: Request) {
    const username = decodeBase64(body.user);
    const passwordPayload = decodeBase64(body.password);
    const [password] = passwordPayload.split('||');
    const mac = body.mac?.toLowerCase() || passwordPayload.split('||')[1]?.toLowerCase();
    const storeCode = body.store_code ?? '';
    const store = this.db.stores.get(storeCode);
    const apId = mac || `ap-${storeCode}`;

    if (store && body.auth_type === 'ap' && proxyOfficialEnabled()) {
      const upstreamAuth = await this.proxyOfficialAuth(body, request, storeCode, apId);
      if (upstreamAuth.ok && typeof upstreamAuth.body === 'object' && upstreamAuth.body) {
        const token = typeof upstreamAuth.body.token === 'string' ? upstreamAuth.body.token : makeLegacyToken(storeCode, apId);
        this.db.registerApSession(token, storeCode, apId, 'official');
        this.upsertAp(apId, storeCode, mac, request);
        this.db.recordRequest({
          method: 'OFFICIAL-AUTH',
          path: upstreamAuth.url,
          statusCode: upstreamAuth.status,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          body: {
            proxied: true,
            apId,
            storeCode,
            rewrittenUser: Boolean(process.env.UPSTREAM_USERNAME),
            upstreamStatus: upstreamAuth.status,
            response: upstreamAuth.body,
          },
        });
        return upstreamAuth.body;
      }
    }

    if (!store || username !== store.username || password !== 'admin123456' || body.auth_type !== 'ap') {
      throw new UnauthorizedException({
        code: 401,
        msg: 'ap auth failed',
      });
    }

    this.upsertAp(apId, storeCode, mac, request);
    const token = makeLegacyToken(storeCode, apId);
    this.db.registerApSession(token, storeCode, apId, 'local');
    return { token };
  }

  private upsertAp(apId: string, storeCode: string, mac: string | undefined, request: Request) {
    const ap: BaseStation = {
      id: apId,
      storeCode,
      name: `AP ${apId}`,
      mac,
      ip: request.ip,
      firmware: 'unknown',
      status: 'online',
      lastSeenAt: new Date().toISOString(),
      metrics: this.db.baseStations.get(apId)?.metrics ?? {},
    };

    this.db.baseStations.set(ap.id, ap);
    this.db.save();
  }

  private async proxyOfficialAuth(body: ApAuthBody, request: Request, storeCode: string, apId: string) {
    loadEnvFiles();
    if (process.env.AP_PROXY_OFFICIAL !== 'true') {
      return { ok: false as const, status: 0, url: '', body: undefined };
    }

    const baseUrl = (process.env.OFFICIAL_CLOUD_URL || process.env.UPSTREAM_CLOUD_URL || 'http://43.153.107.21').replace(/\/$/, '');
    const url = `${baseUrl}/api/websocket/auth`;
    const upstreamUsername = process.env.UPSTREAM_USERNAME;
    const upstreamPassword = process.env.UPSTREAM_PASSWORD;
    const upstreamBody = upstreamUsername && upstreamPassword
      ? {
        ...body,
        user: encodeBase64(upstreamUsername),
        password: encodeBase64(`${upstreamPassword}||${apId}`),
      }
      : body;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': Array.isArray(request.headers['user-agent']) ? request.headers['user-agent'].join(' ') : request.headers['user-agent'] ?? 'Go-http-client/1.1',
        },
        body: JSON.stringify(upstreamBody),
      });
      const text = await response.text();
      let parsed: Record<string, unknown> | string = text;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // Keep raw upstream body for diagnostics.
      }
      return {
        ok: response.ok,
        status: response.status,
        url,
        body: parsed,
      };
    } catch (error) {
      this.db.recordRequest({
        method: 'OFFICIAL-AUTH',
        path: url,
        statusCode: 502,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        body: {
          proxied: true,
          apId,
          storeCode,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return { ok: false as const, status: 502, url, body: undefined };
    }
  }
}
