import { Injectable, NotFoundException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Admin routes (Agents.md §2.1). Runs after the global AuthGuard, so the caller is signed in.
// The role is read from the database on every request, not carried in the access token: a
// token lives 15 minutes, and an admin who is demoted must lose access now, not then.
// A non-admin gets 404, like another user's resource (CLAUDE.md "Ownership"): a 403 would
// tell anyone with an account that admin routes exist here.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const { user } = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const row = await this.prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
    if (row?.role !== 'ADMIN') throw new NotFoundException();
    return true;
  }
}
