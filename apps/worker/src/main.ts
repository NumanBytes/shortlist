import { NestFactory } from '@nestjs/core';
import { loadEnv } from './config/env.js';
import { WorkerModule } from './worker.module.js';

// No HTTP server: this process only consumes the queue. Slow sources and (later)
// 15–20s Claude calls run here, never on the API's event loop (Agents.md §3).
async function bootstrap() {
  loadEnv(); // fail fast on bad config, before connecting to anything
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks(); // finish in-flight jobs and close connections on SIGTERM
}
await bootstrap();
