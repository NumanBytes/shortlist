import type { INestApplication } from '@nestjs/common';

// App-wide settings shared by main.ts and the e2e tests, so tests exercise the
// same routing as production instead of a hand-copied approximation of it.
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  return app;
}
