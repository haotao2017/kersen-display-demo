import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { MemoryStore } from '../../shared/memory-store';
import { IS_PUBLIC_KEY } from './public.decorator';

type Row = Record<string, unknown>;

export type AuthenticatedRequest = Request & { user?: Row };

@Injectable()
export class LocalCloudAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: MemoryStore,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let decoded: Row;
    try {
      decoded = this.jwt.verify<Row>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (decoded.type === 'refresh') {
      throw new UnauthorizedException('Refresh token cannot be used as access token');
    }

    const userId = String(decoded.sub ?? '');
    const user = userId ? this.db.users.get(userId) : undefined;
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (String(user.status ?? 'active') === 'disabled') {
      throw new UnauthorizedException('User is disabled');
    }

    request.user = user;
    return true;
  }
}
