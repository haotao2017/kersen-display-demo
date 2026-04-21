import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { AuthGuard } from '../../shared/auth.guard';
import { MemoryStore } from '../../shared/memory-store';
import { BaseStation } from '../../shared/models';
import { ApWebsocketService } from '../ap-websocket/ap-websocket.service';

class RegisterApDto {
  @IsString()
  id!: string;

  @IsString()
  storeCode!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  mac?: string;

  @IsOptional()
  @IsString()
  ip?: string;

  @IsOptional()
  @IsString()
  firmware?: string;
}

class RawWsCommandDto {
  @IsObject()
  payload!: Record<string, unknown>;
}

@Controller('api/base-stations')
export class BaseStationsController {
  constructor(
    private readonly db: MemoryStore,
    private readonly apWebsocket: ApWebsocketService,
  ) {}

  @UseGuards(AuthGuard)
  @Get()
  list() {
    return [...this.db.baseStations.values()];
  }

  @Post('register')
  register(@Body() dto: RegisterApDto) {
    const current = this.db.baseStations.get(dto.id);
    const ap: BaseStation = {
      id: dto.id,
      storeCode: dto.storeCode,
      name: dto.name ?? current?.name ?? dto.id,
      mac: dto.mac ?? current?.mac,
      ip: dto.ip ?? current?.ip,
      firmware: dto.firmware ?? current?.firmware,
      status: 'online',
      lastSeenAt: new Date().toISOString(),
      metrics: current?.metrics ?? {},
    };
    this.db.baseStations.set(ap.id, ap);
    this.db.save();
    return ap;
  }

  @Post(':id/heartbeat')
  heartbeat(@Param('id') id: string) {
    const ap = this.db.baseStations.get(id);
    if (!ap) {
      return null;
    }
    const next = { ...ap, status: 'online' as const, lastSeenAt: new Date().toISOString() };
    this.db.baseStations.set(id, next);
    this.db.save();
    return next;
  }

  @UseGuards(AuthGuard)
  @Get(':id/ws-status')
  wsStatus(@Param('id') id: string) {
    return this.apWebsocket.getConnectionStatus(id);
  }

  @UseGuards(AuthGuard)
  @Post(':id/ws-command')
  sendWsCommand(@Param('id') id: string, @Body() dto: RawWsCommandDto) {
    return this.apWebsocket.sendRaw(id, dto.payload);
  }
}
