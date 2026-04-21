import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../shared/auth.guard';
import { MqttService } from './mqtt.service';

@UseGuards(AuthGuard)
@Controller('api/mqtt')
export class MqttController {
  constructor(private readonly mqtt: MqttService) {}

  @Get('stats')
  stats() {
    return this.mqtt.stats();
  }
}
