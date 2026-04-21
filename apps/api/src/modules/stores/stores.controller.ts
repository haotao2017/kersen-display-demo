import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { AuthGuard } from '../../shared/auth.guard';
import { MemoryStore } from '../../shared/memory-store';

class UpdateStoreDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  serverUrl?: string;

  @IsOptional()
  @IsNumber()
  mqttTcpPort?: number;

  @IsOptional()
  @IsString()
  mqttWsPath?: string;
}

@UseGuards(AuthGuard)
@Controller('api/stores')
export class StoresController {
  constructor(private readonly db: MemoryStore) {}

  @Get()
  list() {
    return [...this.db.stores.values()].map(({ passwordHash, ...store }) => store);
  }

  @Get(':code')
  get(@Param('code') code: string) {
    const store = this.db.stores.get(code);
    if (!store) {
      return null;
    }
    const { passwordHash, ...safeStore } = store;
    return safeStore;
  }

  @Patch(':code')
  update(@Param('code') code: string, @Body() dto: UpdateStoreDto) {
    const store = this.db.stores.get(code);
    if (!store) {
      return null;
    }
    const next = {
      ...store,
      ...dto,
      updatedAt: new Date().toISOString(),
    };
    this.db.stores.set(code, next);
    this.db.save();
    const { passwordHash, ...safeStore } = next;
    return safeStore;
  }
}
