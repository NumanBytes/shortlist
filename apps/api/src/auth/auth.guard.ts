import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { ALLOW_UNVERIFIED_KEY, IS_PUBLIC_KEY } from './public.decorator.js';
import { TokensService } from './tokens.service.js';

// A guard runs before the route handler and decides whether the request may proceed.
// In plain Express terms: auth middleware that either sets req.user or ends with a 401.
// Registered globally (APP_GUARD in AuthModule), so it covers every route.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload;
    try {
      payload = this.tokens.verifyAccessToken(token);
    } catch {
      // Same message for expired / tampered / malformed — no hints for an attacker.
      throw new UnauthorizedException('Invalid or expired access token');
    }
    request.user = { id: payload.sub };
    // An unverified account may only see itself, resend the email, and sign out (docs/security.md
    // §8.7). 403, not 401: the token is fine; the account isn't allowed yet. The code lets the
    // web app tell this apart from any other 403.
    const allowUnverified = this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!payload.ev && !allowUnverified) {
      throw new ForbiddenException({ message: 'Verify your email address first', code: 'EMAIL_UNVERIFIED' });
    }
    return true;
  }
}
