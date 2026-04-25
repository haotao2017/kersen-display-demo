import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller';
import { AuthModule } from './modules/auth/auth.module';
import { BaseStationsModule } from './modules/base-stations/base-stations.module';
import { LabelsModule } from './modules/labels/labels.module';
import { MqttModule } from './modules/mqtt/mqtt.module';
import { StoresModule } from './modules/stores/stores.module';
import { DeviceLogsModule } from './modules/device-logs/device-logs.module';
import { OfficialApiModule } from './modules/official-api/official-api.module';
import { ApWebsocketModule } from './modules/ap-websocket/ap-websocket.module';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'local-dev-secret',
      signOptions: { expiresIn: '8h' },
    }),
    SharedModule,
    AuthModule,
    StoresModule,
    BaseStationsModule,
    LabelsModule,
    DeviceLogsModule,
    OfficialApiModule,
    ApWebsocketModule,
    MqttModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
