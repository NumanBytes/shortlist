import { Module } from '@nestjs/common';
import { HttpGmailApi, HttpGoogleOAuth } from '@shortlist/shared/node';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { GmailController } from './gmail.controller.js';
import { GMAIL_API, GOOGLE_OAUTH, GmailService } from './gmail.service.js';

@Module({
  controllers: [GmailController],
  providers: [
    GmailService,
    // Providers (not `new` inside the service) so tests can swap in fakes for Google.
    {
      provide: GOOGLE_OAUTH,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI
          ? new HttpGoogleOAuth({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI })
          : null,
    },
    { provide: GMAIL_API, useValue: new HttpGmailApi() },
  ],
})
export class GmailModule {}
