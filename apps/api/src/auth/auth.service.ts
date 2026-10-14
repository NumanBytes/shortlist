import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  type OnModuleInit,
} from '@nestjs/common';
import type { LoginInput, RegisterInput, ResetPasswordInput } from '@shortlist/shared';
import { hashOneTimeToken } from '@shortlist/shared/node';
import { Prisma } from '@shortlist/db';
import bcrypt from 'bcrypt';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueues } from '../queue/job-queues.js';
import { TokensService } from './tokens.service.js';

// Never select passwordHash into anything that can reach a response.
export const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  headline: true,
  targetRole: true,
  location: true,
  phone: true,
  linkedinUrl: true,
  githubUrl: true,
  emailVerifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof PUBLIC_USER_SELECT }>;

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

// One message for "no such email" and "wrong password" — distinct messages would
// let anyone test which emails are registered.
const INVALID_CREDENTIALS = 'Invalid email or password';
const BAD_LINK = 'This link is invalid or has expired — ask for a new one';

@Injectable()
export class AuthService implements OnModuleInit {
  // A real bcrypt hash of a random string, compared against when the email doesn't
  // exist. Without it, "unknown email" returns in ~1ms and "wrong password" in ~250ms,
  // and that timing difference tells an attacker which emails have accounts.
  private dummyHash = '';
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly queues: JobQueues,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // Whether account emails can be sent (docs/security.md §8.7).
  get mailEnabled(): boolean {
    return Boolean(this.env.SMTP_HOST);
  }

  async onModuleInit() {
    this.dummyHash = await bcrypt.hash(crypto.randomUUID(), this.env.BCRYPT_ROUNDS);
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const passwordHash = await bcrypt.hash(input.password, this.env.BCRYPT_ROUNDS);
    try {
      // Without a mail server no email could reach the user, so the account starts verified.
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          emailVerifiedAt: this.mailEnabled ? null : new Date(),
        },
        select: PUBLIC_USER_SELECT,
      });
      // Best effort: if the queue is down the account still exists, and "Send again" works.
      if (!user.emailVerifiedAt) await this.sendVerification(user.id).catch(() => undefined);
      return { user, ...(await this.issueTokens(user.id, this.prisma, Boolean(user.emailVerifiedAt))) };
    } catch (err) {
      // Rely on the unique index rather than a "check, then insert" — two concurrent
      // registrations could both pass the check.
      if (isUniqueViolation(err)) {
        throw new ConflictException('An account with this email already exists');
      }
      throw err;
    }
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const found = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { ...PUBLIC_USER_SELECT, passwordHash: true },
    });
    // Always run a compare, even with no user, so both failure paths take the same time.
    const passwordOk = await bcrypt.compare(input.password, found?.passwordHash ?? this.dummyHash);
    if (!found || !passwordOk) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    const { passwordHash: _, ...user } = found;
    return { user, ...(await this.issueTokens(user.id, this.prisma, Boolean(user.emailVerifiedAt))) };
  }

  // Refresh-token rotation: each refresh token works exactly once. Using it revokes it
  // and issues a new pair. If a token that was ALREADY revoked shows up again, two
  // parties hold it — the user and a thief — and we can't tell which is which, so we
  // revoke every session the user has and force a fresh login.
  async refresh(refreshToken: string): Promise<AuthResult> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.revokedAt) {
      await this.revokeAllSessions(stored.userId);
      throw new UnauthorizedException('Refresh token reuse detected; all sessions revoked');
    }
    if (stored.expiresAt <= new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    return this.prisma.$transaction(async (tx) => {
      // Conditional update = compare-and-swap. If two requests race with the same
      // token, only one sees count === 1; the other loses instead of both winning.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      const user = await tx.user.findUniqueOrThrow({
        where: { id: stored.userId },
        select: PUBLIC_USER_SELECT,
      });
      return { user, ...(await this.issueTokens(user.id, tx, Boolean(user.emailVerifiedAt))) };
    });
  }

  // Idempotent and silent: logging out an unknown or already-revoked token is not an
  // error, and the response never reveals whether the token existed.
  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ── Account emails (docs/security.md §8.7) ──

  async sendVerification(userId: string): Promise<void> {
    if (!this.mailEnabled) throw new ServiceUnavailableException("Email isn't set up on this server");
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
    if (!user) throw new UnauthorizedException('User no longer exists');
    if (user.emailVerifiedAt) throw new ConflictException('Your email is already verified');
    await this.queues.enqueueAuthEmail(userId, 'VERIFY_EMAIL');
  }

  // Public: works from the link whether or not this browser is signed in.
  async verifyEmail(token: string): Promise<void> {
    const userId = await this.useToken(token, 'VERIFY_EMAIL');
    await this.prisma.user.updateMany({
      where: { id: userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
  }

  // Answers the same whether or not the email has an account — anything else would let
  // anyone test which emails are registered. The work happens in the worker, so even the
  // response time doesn't differ by much.
  async requestPasswordReset(email: string): Promise<void> {
    if (!this.mailEnabled) throw new ServiceUnavailableException("Password reset by email isn't set up on this server");
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return;
    await this.queues.enqueueAuthEmail(user.id, 'RESET_PASSWORD').catch((err: Error) => {
      // Logged, not returned: a 503 here would tell the caller the account exists.
      this.logger.error(`Password reset email not queued: ${err.message}`);
    });
  }

  // A new password ends every session (a reset is often "someone else got in"), and proves
  // the user controls the inbox, so it verifies the address too.
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const passwordHash = await bcrypt.hash(input.password, this.env.BCRYPT_ROUNDS);
    const userId = await this.useToken(input.token, 'RESET_PASSWORD');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.user.updateMany({
        where: { id: userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.authToken.deleteMany({ where: { userId, purpose: 'RESET_PASSWORD', usedAt: null } }),
    ]);
  }

  // Spends a one-time token: only its hash is stored, it must be unexpired and unused, and the
  // conditional update is a compare-and-swap — two clicks racing on one link can't both win.
  private async useToken(token: string, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD'): Promise<string> {
    const stored = await this.prisma.authToken.findUnique({ where: { tokenHash: hashOneTimeToken(token) } });
    if (!stored || stored.purpose !== purpose || stored.usedAt || stored.expiresAt <= new Date()) {
      throw new BadRequestException(BAD_LINK);
    }
    const { count } = await this.prisma.authToken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw new BadRequestException(BAD_LINK);
    return stored.userId;
  }

  async findPublicUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PUBLIC_USER_SELECT,
    });
    // A valid access token for a deleted user: treat as signed out.
    if (!user) throw new UnauthorizedException('User no longer exists');
    return user;
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    db: Prisma.TransactionClient,
    emailVerified: boolean,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const { token, tokenHash, expiresAt } = this.tokens.generateRefreshToken();
    // Every refresh adds a row, so prune this user's expired ones as we go — the table stays
    // bounded by the token lifetime without a scheduled job. Revoked-but-unexpired rows stay:
    // reuse detection needs them until they'd have expired anyway.
    await db.refreshToken.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
    await db.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
    return { accessToken: this.tokens.signAccessToken(userId, emailVerified), refreshToken: token };
  }
}
