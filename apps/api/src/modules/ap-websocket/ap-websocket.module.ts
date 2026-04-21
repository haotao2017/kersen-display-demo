import { Module } from '@nestjs/common';
import { ApWebsocketController } from './ap-websocket.controller';
import { ApWebsocketService } from './ap-websocket.service';

@Module({
  controllers: [ApWebsocketController],
  providers: [ApWebsocketService],
  exports: [ApWebsocketService],
})
export class ApWebsocketModule {}
