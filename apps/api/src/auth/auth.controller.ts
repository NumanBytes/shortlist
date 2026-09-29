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
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: RegisterInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.register(body));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK) // nothing is created, so 200 rather than Nest's POST default of 201
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.login(body));
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

  // The refresh token goes into the cookie and is stripped from the body.
  private respond(res: Response, { refreshToken, ...body }: AuthResult) {
    setRefreshCookie(res, refreshToken, this.env);
    return body;
  }
}
