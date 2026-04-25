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

class ReplayOfficialDownlinkDto {
  @IsOptional()
  @IsString()
  targetLabelId?: string;

  @IsOptional()
  @IsString()
  replacementService03B64?: string;

  @IsOptional()
  @IsString()
  replacementService07B64?: string;

  @IsOptional()
  @IsString()
  replacementService0cB64?: string;

  @IsOptional()
  service03ByteOffset?: number;

  @IsOptional()
  service03ByteXor?: number;

  @IsOptional()
  @IsString()
  spliceSourceCaptureId?: string;

  @IsOptional()
  spliceOffset?: number;
}

class DiffOfficialDownlinkDto {
  @IsString()
  leftId!: string;

  @IsString()
  rightId!: string;
}

class StructureOfficialDownlinkDto {
  @IsOptional()
  captureIds?: string[];
}

function offlineAfterMs() {
  return Number(process.env.AP_OFFLINE_AFTER_SECONDS ?? 90) * 1000;
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
    return [...this.db.baseStations.values()].map((ap) => {
      const lastSeenAt = ap.lastSeenAt ? new Date(ap.lastSeenAt).getTime() : 0;
      const stale = !lastSeenAt || Date.now() - lastSeenAt > offlineAfterMs();
      if (!stale) {
        return ap;
      }
      return {
        ...ap,
        status: 'offline' as const,
      };
    });
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
  @Get(':id/downlink-traces')
  downlinkTraces(@Param('id') id: string) {
    return this.apWebsocket.getDownlinkTraces(id);
  }

  @UseGuards(AuthGuard)
  @Get(':id/downlink-traces/:traceId')
  downlinkTrace(@Param('id') id: string, @Param('traceId') traceId: string) {
    return this.apWebsocket.getDownlinkTrace(id, traceId) ?? { ok: false, reason: 'trace_not_found', traceId };
  }

  @UseGuards(AuthGuard)
  @Get(':id/official-downlinks')
  officialDownlinks(@Param('id') id: string) {
    return this.apWebsocket.getOfficialDownlinks(id);
  }

  @UseGuards(AuthGuard)
  @Get(':id/official-downlinks/analysis')
  officialDownlinkAnalysis(@Param('id') id: string) {
    return this.apWebsocket.analyzeOfficialDownlinks(id);
  }

  @UseGuards(AuthGuard)
  @Post(':id/official-downlinks/structure')
  officialDownlinkStructure(@Param('id') id: string, @Body() dto: StructureOfficialDownlinkDto) {
    return this.apWebsocket.analyzeOfficialDownlinkStructure(id, dto.captureIds);
  }

  @UseGuards(AuthGuard)
  @Post(':id/official-downlinks/:captureId/replay')
  replayOfficialDownlink(
    @Param('id') id: string,
    @Param('captureId') captureId: string,
    @Body() dto: ReplayOfficialDownlinkDto,
  ) {
    return this.apWebsocket.replayOfficialDownlink(id, captureId, {
      targetLabelId: dto.targetLabelId,
      replacementService03B64: dto.replacementService03B64,
      replacementService07B64: dto.replacementService07B64,
      replacementService0cB64: dto.replacementService0cB64,
      service03ByteOffset: dto.service03ByteOffset,
      service03ByteXor: dto.service03ByteXor,
      spliceSourceCaptureId: dto.spliceSourceCaptureId,
      spliceOffset: dto.spliceOffset,
    });
  }

  @UseGuards(AuthGuard)
  @Post(':id/official-downlinks/diff')
  diffOfficialDownlinks(@Param('id') id: string, @Body() dto: DiffOfficialDownlinkDto) {
    return this.apWebsocket.diffOfficialDownlinks(id, dto.leftId, dto.rightId);
  }

  @UseGuards(AuthGuard)
  @Post(':id/ws-command')
  sendWsCommand(@Param('id') id: string, @Body() dto: RawWsCommandDto) {
    return this.apWebsocket.sendRaw(id, dto.payload);
  }
}
