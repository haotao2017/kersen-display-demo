import { Module } from '@nestjs/common';
import { ApWebsocketModule } from '../ap-websocket/ap-websocket.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { LabelsController } from './labels.controller';

@Module({
  imports: [ApWebsocketModule, MqttModule],
  controllers: [LabelsController],
})
export class LabelsModule {}
