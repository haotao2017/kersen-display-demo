import { Module } from '@nestjs/common';
import { ApWebsocketModule } from '../ap-websocket/ap-websocket.module';
import { BaseStationsController } from './base-stations.controller';

@Module({
  imports: [ApWebsocketModule],
  controllers: [BaseStationsController],
})
export class BaseStationsModule {}
