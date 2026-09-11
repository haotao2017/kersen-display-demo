import 'reflect-metadata';
import { loadEnvFiles } from './shared/load-env';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, NextFunction, Request, Response, urlencoded } from 'express';
import { AppModule } from './app.module';
import { ApWebsocketService } from './modules/ap-websocket/ap-websocket.service';
import { MqttService } from './modules/mqtt/mqtt.service';
import { MemoryStore } from './shared/memory-store';
import { validateProductionConfig } from './shared/production-config';

loadEnvFiles();
validateProductionConfig();

function isLoopback(ip?: string) {
  return !ip || ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
}

const SENSITIVE_BODY_KEYS = new Set(['password', 'newpassword', 'oldpassword', 'refreshtoken', 'accesstoken', 'token']);

function redactSensitiveBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([key, value]) => [
      key,
      SENSITIVE_BODY_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : value,
    ]),
  );
}

function isConsoleNoise(path: string, ip?: string, userAgent?: string | string[]) {
  const ua = Array.isArray(userAgent) ? userAgent.join(' ') : (userAgent ?? '');
  if (!isLoopback(ip) || !ua.includes('Mozilla')) {
    return false;
  }

  return (
    path.startsWith('/api/stores/') ||
    path === '/api/base-stations' ||
    path === '/api/labels'
  );
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  const bodyLimit = process.env.API_BODY_LIMIT ?? '25mb';

  app.enableCors({
    origin: corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: true,
  });
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const db = app.get(MemoryStore);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.originalUrl ?? req.url).startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }

    const startedAt = Date.now();
    res.on('finish', () => {
      const path = req.originalUrl ?? req.url;
      if (path.startsWith('/api/device-logs')) {
        return;
      }
      if (req.method === 'GET' && (
        path.startsWith('/api/v1/tasks')
        || path.startsWith('/api/v1/products')
        || path.startsWith('/api/v1/templates')
        || path.startsWith('/api/v1/esl-devices')
        || path.startsWith('/api/v1/dashboard')
      )) {
        return;
      }
      if (isConsoleNoise(path, req.ip, req.headers['user-agent'])) {
        return;
      }

      db.recordRequest({
        method: req.method,
        path,
        statusCode: res.statusCode,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        query: req.query,
        body: redactSensitiveBody(req.body),
      });

      if (Date.now() - startedAt > 1000) {
        // Keep the branch explicit for later timing diagnostics.
      }
    });
    next();
  });

  const mqtt = app.get(MqttService);
  const apWebsocket = app.get(ApWebsocketService);
  mqtt.onExternalPublish(({ topic, parsed }) => {
    apWebsocket.forwardMqttCommand(topic, parsed);
  });
  await mqtt.start();

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);

  apWebsocket.attach(app.getHttpServer());
}

bootstrap();
