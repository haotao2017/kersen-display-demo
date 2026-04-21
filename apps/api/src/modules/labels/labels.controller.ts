import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { MqttService } from '../mqtt/mqtt.service';
import { AuthGuard } from '../../shared/auth.guard';
import { MemoryStore } from '../../shared/memory-store';
import { Label } from '../../shared/models';
import { ApWebsocketService } from '../ap-websocket/ap-websocket.service';

class UpsertLabelDto {
  @IsString()
  id!: string;

  @IsString()
  storeCode!: string;

  @IsOptional()
  @IsString()
  apId?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsString()
  title!: string;

  @IsNumber()
  price!: number;

  @IsOptional()
  @IsString()
  currency?: string;
}

class CommandDto {
  @IsString()
  storeCode!: string;

  @IsString()
  type!: 'refresh_label' | 'bind_label' | 'raw';

  @IsObject()
  payload!: Record<string, unknown>;
}

@UseGuards(AuthGuard)
@Controller('api/labels')
export class LabelsController {
  constructor(
    private readonly db: MemoryStore,
    private readonly mqtt: MqttService,
    private readonly apWebsocket: ApWebsocketService,
  ) {}

  @Get()
  list() {
    return [...this.db.labels.values()];
  }

  @Post()
  upsert(@Body() dto: UpsertLabelDto) {
    const label: Label = {
      id: dto.id,
      storeCode: dto.storeCode,
      apId: dto.apId,
      sku: dto.sku,
      title: dto.title,
      price: dto.price,
      currency: dto.currency ?? 'CNY',
      status: 'idle',
      battery: this.db.labels.get(dto.id)?.battery,
      updatedAt: new Date().toISOString(),
    };
    this.db.labels.set(label.id, label);
    this.db.save();
    return label;
  }

  @Post(':id/commands')
  async command(@Param('id') id: string, @Body() dto: CommandDto) {
    const command = this.db.createCommand({
      storeCode: dto.storeCode,
      targetType: 'label',
      targetId: id,
      type: dto.type,
      payload: dto.payload,
    });

    const label = this.db.labels.get(id);
    const apId = label?.apId ?? [...this.db.baseStations.values()].find((item) => item.status === 'online')?.id;
    const wsPayload = dto.type === 'raw' ? dto.payload : {
      type: 'LABEL_COMMAND',
      command_id: command.id,
      label_id: id,
      command_type: dto.type,
      payload: dto.payload,
    };

    const wsResult = apId ? this.apWebsocket.sendRaw(apId, wsPayload) : { ok: false, reason: 'No online AP found' };
    if (wsResult.ok) {
      command.status = 'sent';
      command.sentAt = new Date().toISOString();
      this.db.commands.set(command.id, command);
      this.db.save();
      return { ...command, transport: 'websocket', delivery: wsResult };
    }

    await this.mqtt.publishLabelCommand(command);
    return command;
  }
}
