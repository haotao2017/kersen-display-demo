import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: unknown }>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: Record<string, unknown>;
    try {
      payload = this.jwt.verify<Record<string, unknown>>(token);
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }
    if (payload.type === 'refresh') {
      throw new UnauthorizedException('Refresh token cannot be used as access token');
    }
    request.user = payload;
    return true;
  }
}
