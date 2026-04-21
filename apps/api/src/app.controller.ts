import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  index() {
    return {
      service: 'kersen-esl-cloud-api',
      console: process.env.CONSOLE_URL ?? 'http://localhost:5173',
      health: '/health',
      login: {
        url: '/api/auth/login',
        defaultStoreCode: process.env.UPSTREAM_STORE_CODE ?? '20248517',
        defaultUsername: 'admin',
        defaultPassword: 'admin123456',
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
}
