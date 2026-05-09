import { Controller, Get } from '@nestjs/common';
import { RefreshQueueService } from './modules/refresh-queue/refresh-queue.service';
import { PersistentStoreService } from './shared/persistent-store.service';

@Controller()
export class AppController {
  constructor(
    private readonly persistentStore: PersistentStoreService,
    private readonly refreshQueue: RefreshQueueService,
  ) {}

  @Get()
  index() {
    const production = process.env.NODE_ENV === 'production';
    return {
      service: 'kersen-esl-cloud-api',
      console: process.env.CONSOLE_URL ?? 'http://localhost:5173',
      health: '/health',
      login: {
        url: '/api/auth/login',
        defaultStoreCode: process.env.UPSTREAM_STORE_CODE ?? '20248517',
        defaultUsername: production ? undefined : 'admin',
        defaultPassword: production ? undefined : 'admin123456',
      },
      baseStationConfig: {
        serverAddress: process.env.PUBLIC_SERVER_URL ?? 'http://YOUR_LAN_IP:4000',
        storeCode: process.env.UPSTREAM_STORE_CODE ?? '20248517',
        username: 'admin',
        password: 'admin123456',
        mqttTcpPort: Number(process.env.MQTT_TCP_PORT ?? 1883),
        mqttWebSocket: `ws://YOUR_LAN_IP:${Number(process.env.API_PORT ?? 4000) + 1}${process.env.MQTT_WS_PATH ?? '/mqtt'}`,
      },
      note: 'Open the React console URL to log in. Configure a real base station with a LAN/Public IP or domain, not localhost.',
    };
  }

  @Get('health')
  health() {
    return {
      ok: true,
      service: 'kersen-esl-cloud-api',
      time: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready() {
    const [database, queue] = await Promise.all([
      this.persistentStore.health(),
      this.refreshQueue.health(),
    ]);
    return {
      ok: database.ok && queue.ok,
      service: 'kersen-esl-cloud-api',
      time: new Date().toISOString(),
      database,
      queue,
    };
  }
}
