import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../shared/auth.guard';
import { MemoryStore } from '../../shared/memory-store';

function isLoopback(ip?: string) {
  return !ip || ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
}

@UseGuards(AuthGuard)
@Controller('api/device-logs')
export class DeviceLogsController {
  constructor(private readonly db: MemoryStore) {}

  @Get()
  list(@Query('all') all?: string) {
    const logs = this.db.requestLogs.slice(0, 150);
    if (all === '1') {
      return logs;
    }

    return logs.filter((log) => {
      const ua = log.userAgent ?? '';
      return !isLoopback(log.ip) || log.method === 'WS' || ua.includes('Go-http-client');
    });
  }
}
