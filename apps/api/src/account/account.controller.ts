import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Inject, Req, Res } from '@nestjs/common';
import { DeleteAccountSchema, type DeleteAccountInput } from '@shortlist/shared';
import type { Request, Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { AllowUnverified } from '../auth/public.decorator.js';
import { clearRefreshCookie } from '../auth/refresh-cookie.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AuthRateLimits, TooManyRequestsException } from '../rate-limit/auth-rate-limits.js';
import { AccountService, WrongPassword } from './account.service.js';

// Export and deletion (docs/security.md §8.8). Allowed before the email is verified: someone
// who signed up by mistake, or with a typo in their address, must still be able to leave.
@Controller('account')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly limits: AuthRateLimits,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('export')
  @AllowUnverified()
  @Header('Content-Disposition', 'attachment; filename="shortlist-export.json"')
  @Header('Cache-Control', 'no-store')
  export(@CurrentUser() user: AuthUser) {
    return this.account.export(user.id);
  }

  @Delete()
  @AllowUnverified()
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(DeleteAccountSchema)) body: DeleteAccountInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // The password check here is a password oracle like /auth/login, so it shares login's
    // limits: per IP, and per account (keyed by the user id, since the caller is known).
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = `account:${user.id}`;
    try {
      await this.limits.beforeLogin(ip, key);
    } catch (err) {
      if (err instanceof TooManyRequestsException) res.setHeader('Retry-After', String(err.retryAfterSeconds));
      throw err;
    }
    try {
      await this.account.delete(user.id, body.password);
    } catch (err) {
      if (err instanceof WrongPassword) await this.limits.loginFailed(key);
      throw err;
    }
    // The sessions went with the account; the browser's cookie is now useless, so drop it.
    clearRefreshCookie(res, this.env);
  }
}
