import { Global, Module } from '@nestjs/common';
import { MemoryStore } from './memory-store';
import { PersistentStoreService } from './persistent-store.service';

@Global()
@Module({
  providers: [MemoryStore, PersistentStoreService],
  exports: [MemoryStore, PersistentStoreService],
})
export class SharedModule {}
