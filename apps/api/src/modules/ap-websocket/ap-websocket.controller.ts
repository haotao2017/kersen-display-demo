import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'node:crypto';
import { MemoryStore } from '../../shared/memory-store';
import { BaseStation } from '../../shared/models';

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

@Controller('api/websocket')
export class ApWebsocketController {
  constructor(private readonly db: MemoryStore) {}

  @Post('auth')
  @HttpCode(200)
  auth(@Body() body: ApAuthBody, @Req() request: Request) {
    const username = decodeBase64(body.user);
    const passwordPayload = decodeBase64(body.password);
    const [password] = passwordPayload.split('||');
    const mac = body.mac?.toLowerCase() || passwordPayload.split('||')[1]?.toLowerCase();
    const storeCode = body.store_code ?? '';
    const store = this.db.stores.get(storeCode);

    if (!store || username !== store.username || password !== 'admin123456' || body.auth_type !== 'ap') {
      throw new UnauthorizedException({
        code: 401,
        msg: 'ap auth failed',
      });
    }

    const apId = mac || `ap-${storeCode}`;
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

    const token = makeLegacyToken(storeCode, apId);
    this.db.registerApSession(token, storeCode, apId);

    return { token };
  }
}
