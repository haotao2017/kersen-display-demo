import { Module } from '@nestjs/common';
import { DeviceLogsController } from './device-logs.controller';

@Module({
  controllers: [DeviceLogsController],
})
export class DeviceLogsModule {}
