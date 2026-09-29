import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
  type OnModuleInit,
} from '@nestjs/common';
import type { LoginInput, RegisterInput } from '@shortlist/shared';
import { Prisma } from '@shortlist/db';
import bcrypt from 'bcrypt';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TokensService } from './tokens.service.js';

// Never select passwordHash into anything that can reach a response.
export const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  headline: true,
  targetRole: true,
  location: true,
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

@Injectable()
export class AuthService implements OnModuleInit {
  // A real bcrypt hash of a random string, compared against when the email doesn't
  // exist. Without it, "unknown email" returns in ~1ms and "wrong password" in ~250ms,
  // and that timing difference tells an attacker which emails have accounts.
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit() {
    this.dummyHash = await bcrypt.hash(crypto.randomUUID(), this.env.BCRYPT_ROUNDS);
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const passwordHash = await bcrypt.hash(input.password, this.env.BCRYPT_ROUNDS);
    try {
      const user = await this.prisma.user.create({
        data: { email: input.email, name: input.name, passwordHash },
        select: PUBLIC_USER_SELECT,
      });
      return { user, ...(await this.issueTokens(user.id)) };
    } catch (err) {
      // Rely on the unique index rather than a "check, then insert" — two concurrent
      // registrations could both pass the check. P2002 = unique constraint violation.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
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
    return { user, ...(await this.issueTokens(user.id)) };
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
      return { user, ...(await this.issueTokens(user.id, tx)) };
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
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const { token, tokenHash, expiresAt } = this.tokens.generateRefreshToken();
    await db.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
    return { accessToken: this.tokens.signAccessToken(userId), refreshToken: token };
  }
}
