import { Global, Module } from '@nestjs/common';
import { RefreshQueueService } from './refresh-queue.service';

@Global()
@Module({
  providers: [RefreshQueueService],
  exports: [RefreshQueueService],
})
export class RefreshQueueModule {}
