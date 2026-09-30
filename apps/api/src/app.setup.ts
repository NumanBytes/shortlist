import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';

// App-wide settings shared by main.ts and the e2e tests, so tests exercise the
// same routing as production instead of a hand-copied approximation of it.
export function configureApp(app: INestApplication): INestApplication {
  const env = app.get<Env>(ENV);

  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(cookieParser());

  // CORS only matters when web and API are different origins (e.g. app. and api.
  // subdomains). In development Vite proxies /api, so the browser sees one origin.
  // `credentials: true` is what allows the refresh cookie on cross-origin requests,
  // which is why the allowlist must be exact origins, never "*".
  app.enableCors({ origin: env.WEB_ORIGINS, credentials: true });

  return app;
}
