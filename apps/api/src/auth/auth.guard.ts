import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
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

    try {
      const { sub } = this.tokens.verifyAccessToken(token);
      request.user = { id: sub };
      return true;
    } catch {
      // Same message for expired / tampered / malformed — no hints for an attacker.
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
