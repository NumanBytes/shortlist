import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginSchema, RegisterSchema, type LoginInput, type RegisterInput } from '@shortlist/shared';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AuthRateLimits, TooManyRequestsException } from '../rate-limit/auth-rate-limits.js';
import { AuthService, type AuthResult } from './auth.service.js';
import { CurrentUser, type AuthUser } from './current-user.decorator.js';
import { Public } from './public.decorator.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie.js';

// `passthrough: true` lets us set cookies on the response while still returning a
// value for Nest to serialize, instead of taking over the response entirely.
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly limits: AuthRateLimits,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.limited(res, this.limits.beforeRegister(clientIp(req)));
    return this.respond(res, await this.auth.register(body));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK) // nothing is created, so 200 rather than Nest's POST default of 201
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Rate limits live here, not in a guard: only the handler knows whether the attempt
    // FAILED, and failures are what count against an account (docs/security.md §8.1).
    await this.limited(res, this.limits.beforeLogin(clientIp(req), body.email));
    let result: AuthResult;
    try {
      result = await this.auth.login(body);
    } catch (err) {
      if (err instanceof UnauthorizedException) await this.limits.loginFailed(body.email);
      throw err;
    }
    await this.limits.loginSucceeded(body.email);
    return this.respond(res, result);
  }

  // Public: the access token has usually expired by the time a client calls this.
  // The refresh cookie is the credential.
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readRefreshCookie(req);
    if (!token) throw new UnauthorizedException('Not signed in');
    try {
      return this.respond(res, await this.auth.refresh(token));
    } catch (err) {
      // A dead token is useless to the browser; clear it so the client stops retrying.
      clearRefreshCookie(res, this.env);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readRefreshCookie(req);
    if (token) await this.auth.logout(token);
    clearRefreshCookie(res, this.env);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.findPublicUser(user.id);
  }

  // A refused attempt is a 429 with Retry-After, so clients know when to come back.
  private async limited(res: Response, check: Promise<void>) {
    try {
      await check;
    } catch (err) {
      if (err instanceof TooManyRequestsException) res.setHeader('Retry-After', String(err.retryAfterSeconds));
      throw err;
    }
  }

  // The refresh token goes into the cookie and is stripped from the body.
  private respond(res: Response, { refreshToken, ...body }: AuthResult) {
    setRefreshCookie(res, refreshToken, this.env);
    return body;
  }
}

// The caller's address as Express resolved it. Behind a proxy that's only the real client
// when `trust proxy` is set to the number of proxies in front (TRUST_PROXY_HOPS);
// otherwise every request would share the proxy's IP — one limit for everyone.
const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';
