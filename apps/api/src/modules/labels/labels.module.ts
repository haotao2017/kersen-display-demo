import { Module } from '@nestjs/common';
import { ApWebsocketModule } from '../ap-websocket/ap-websocket.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { LabelRendererService } from './label-renderer.service';
import { LabelsController } from './labels.controller';

@Module({
  imports: [ApWebsocketModule, MqttModule],
  controllers: [LabelsController],
  providers: [LabelRendererService],
  exports: [LabelRendererService],
})
export class LabelsModule {}
