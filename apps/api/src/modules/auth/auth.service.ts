import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { MemoryStore } from '../../shared/memory-store';

@Injectable()
export class AuthService {
  constructor(
    private readonly store: MemoryStore,
    private readonly jwt: JwtService,
  ) {}

  login(storeCode: string, username: string, password: string) {
    const store = this.store.stores.get(storeCode);
    if (!store || store.username !== username) {
      throw new UnauthorizedException('Invalid store or username');
    }

    if (!bcrypt.compareSync(password, store.passwordHash)) {
      throw new UnauthorizedException('Invalid password');
    }

    const accessToken = this.jwt.sign({
      sub: store.id,
      storeCode: store.code,
      username: store.username,
    });

    return {
      accessToken,
      store: {
        code: store.code,
        name: store.name,
        serverUrl: store.serverUrl,
        mqttTcpPort: store.mqttTcpPort,
        mqttWsPath: store.mqttWsPath,
      },
    };
  }
}
