import { Controller, Delete, Get, HttpCode, HttpStatus, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { GmailService } from './gmail.service.js';

// Binds a connect attempt to the browser that started it (see OAuthState). SameSite=Lax,
// not Strict: Google's redirect back is a cross-site top-level navigation, and a Strict
// cookie wouldn't be sent on it. Path-scoped to the callback, httpOnly, 10 minutes.
const NONCE_COOKIE = 'shortlist_oauth';
const CALLBACK_PATH = '/api/v1/gmail/callback';

@Controller('gmail')
export class GmailController {
  constructor(
    private readonly gmail: GmailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, sameSite: 'lax', secure: this.env.NODE_ENV === 'production', path: CALLBACK_PATH };
  }

  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.gmail.status(user.id);
  }

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  async connect(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const { url, nonce } = await this.gmail.startConnect(user.id);
    res.cookie(NONCE_COOKIE, nonce, { ...this.cookieOptions(), maxAge: 10 * 60 * 1000 });
    return { url };
  }

  // Google sends the browser here. Public: a redirect carries no bearer token — the state
  // and the cookie identify the attempt. Always ends with a redirect back to the app.
  @Public()
  @Get('callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const nonce: unknown = req.cookies?.[NONCE_COOKIE];
    const outcome = await this.gmail.finishConnect({ code, state, error, nonce: typeof nonce === 'string' ? nonce : undefined });
    res.clearCookie(NONCE_COOKIE, this.cookieOptions());
    res.redirect(303, `${this.env.WEB_APP_URL}/sources?gmail=${outcome}`);
  }

  @Post('check')
  @HttpCode(HttpStatus.ACCEPTED)
  check(@CurrentUser() user: AuthUser) {
    return this.gmail.checkNow(user.id);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(@CurrentUser() user: AuthUser) {
    await this.gmail.disconnect(user.id);
  }
}
