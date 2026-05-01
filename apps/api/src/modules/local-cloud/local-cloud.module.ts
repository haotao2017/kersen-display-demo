import { Module } from '@nestjs/common';
import { ApWebsocketModule } from '../ap-websocket/ap-websocket.module';
import { LabelsModule } from '../labels/labels.module';
import { LocalCloudController } from './local-cloud.controller';

@Module({
  imports: [ApWebsocketModule, LabelsModule],
  controllers: [LocalCloudController],
})
export class LocalCloudModule {}
