import { Module } from '@nestjs/common';
import { ApWebsocketModule } from '../ap-websocket/ap-websocket.module';
import { OfficialApiController } from './official-api.controller';
import { OfficialApiService } from './official-api.service';

@Module({
  imports: [ApWebsocketModule],
  controllers: [OfficialApiController],
  providers: [OfficialApiService],
})
export class OfficialApiModule {}
