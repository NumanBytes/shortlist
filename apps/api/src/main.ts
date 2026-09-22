import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';

async function bootstrap() {
  const env = loadEnv(); // fail fast, before anything else starts

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.enableShutdownHooks(); // close DB connections cleanly on deploy restarts

  await app.listen(env.PORT);
  console.log(`API listening on http://localhost:${env.PORT}`);
}
await bootstrap();
