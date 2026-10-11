import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { emailSourceKey } from '@shortlist/shared';
import {
  GMAIL_READONLY_SCOPE,
  SecretBox,
  authorizationUrl,
  pkcePair,
  type GmailApi,
  type GoogleOAuth,
} from '@shortlist/shared/node';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueues } from '../queue/job-queues.js';

export const GOOGLE_OAUTH = Symbol('GOOGLE_OAUTH');
export const GMAIL_API = Symbol('GMAIL_API');

const STATE_TTL_MS = 10 * 60 * 1000;
const SUMMARY_DAYS = 30;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const random = () => randomBytes(32).toString('base64url');

// Why a connect attempt ended, as shown to the user on the Sources page.
export type ConnectOutcome =
  'connected' | 'denied' | 'expired' | 'mismatch' | 'scope' | 'no_refresh_token' | 'google_error';

// Connecting Gmail read-only (docs/email-alerts.md §10.3). The API runs the OAuth handshake and
// stores the encrypted refresh token; the worker does all the reading.
@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);
  private readonly box: SecretBox | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: JobQueues,
    @Inject(ENV) private readonly env: Env,
    @Inject(GOOGLE_OAUTH) private readonly oauth: GoogleOAuth | null,
    @Inject(GMAIL_API) private readonly gmail: GmailApi,
  ) {
    this.box = env.TOKEN_ENCRYPTION_KEY ? new SecretBox(env.TOKEN_ENCRYPTION_KEY) : null;
  }

  get configured() {
    return this.oauth !== null && this.box !== null && !!this.env.GOOGLE_CLIENT_ID && !!this.env.GOOGLE_REDIRECT_URI;
  }

  async status(userId: string) {
    const since = new Date(Date.now() - SUMMARY_DAYS * 24 * 3600 * 1000);
    const recent = { userId, readAt: { gte: since } };
    const [connection, byStatus, byPortal, warnings, sources] = await Promise.all([
      this.prisma.gmailConnection.findUnique({
        where: { userId },
        select: {
          emailAddress: true,
          labelName: true,
          status: true,
          lastError: true,
          connectedAt: true,
          lastCheckedAt: true,
          lastCheckStatus: true,
          lastCheckFound: true,
        },
      }),
      this.prisma.emailMessage.groupBy({ by: ['status'], where: recent, _count: true }),
      this.prisma.emailMessage.groupBy({
        by: ['portal'],
        where: { ...recent, status: 'PARSED' },
        _count: true,
        _sum: { jobsFound: true },
      }),
      // A code parser that found nothing (or threw) and handed the email to the model: the
      // portal probably changed its email layout (docs/email-alerts.md §10.4).
      this.prisma.emailMessage.groupBy({ by: ['portal'], where: { ...recent, parserFailed: true }, _count: true }),
      this.prisma.jobSource.findMany({
        where: { userId, type: 'EMAIL_INBOX', lastRunAt: { not: null } },
        select: {
          id: true,
          key: true,
          name: true,
          discoveryRuns: {
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: { status: true, jobsNew: true, finishedAt: true },
          },
        },
      }),
    ]);
    const counts = Object.fromEntries(byStatus.map((g) => [g.status, g._count]));
    const warningsBy = new Map(warnings.map((w) => [w.portal, w._count]));
    const sourceBy = new Map(sources.map((src) => [src.key, src]));
    return {
      configured: this.configured,
      connection,
      last30Days: {
        alerts: counts.PARSED ?? 0,
        notAlerts: counts.NOT_ALERT ?? 0,
        deferred: counts.DEFERRED ?? 0,
        failed: counts.FAILED ?? 0,
        portals: byPortal
          .filter((p) => p.portal)
          .sort((a, b) => b._count - a._count)
          .map((p) => {
            const src = sourceBy.get(emailSourceKey(p.portal!));
            return {
              portal: p.portal!,
              sourceId: src?.id ?? null,
              label: src?.name ?? p.portal!,
              emails: p._count,
              jobsFound: p._sum.jobsFound ?? 0,
              parserWarnings: warningsBy.get(p.portal) ?? 0,
              lastRun: src?.discoveryRuns[0] ?? null,
            };
          }),
      },
    };
  }

  // Step 1: the signed-in user asks to connect. Returns Google's consent URL plus a nonce
  // the controller sets as a cookie in this browser.
  async startConnect(userId: string): Promise<{ url: string; nonce: string }> {
    if (!this.configured) throw new ServiceUnavailableException("Gmail isn't configured on this server");
    const state = random();
    const nonce = random();
    const { verifier, challenge } = pkcePair();
    await this.prisma.$transaction([
      // Old unfinished attempts are useless; don't let them pile up.
      this.prisma.oAuthState.deleteMany({ where: { OR: [{ userId }, { expiresAt: { lt: new Date() } }] } }),
      this.prisma.oAuthState.create({
        data: {
          userId,
          stateHash: sha256(state),
          nonceHash: sha256(nonce),
          codeVerifier: verifier,
          expiresAt: new Date(Date.now() + STATE_TTL_MS),
        },
      }),
    ]);
    const url = authorizationUrl(
      { clientId: this.env.GOOGLE_CLIENT_ID!, clientSecret: '', redirectUri: this.env.GOOGLE_REDIRECT_URI! },
      { state, codeChallenge: challenge },
    );
    return { url, nonce };
  }

  // Step 2: Google redirects the browser back here. No bearer token arrives with a browser
  // redirect, so the user is identified by the single-use state — and the cookie nonce
  // proves it's the same browser that started.
  async finishConnect(p: { code?: string; state?: string; error?: string; nonce?: string }): Promise<ConnectOutcome> {
    if (!this.configured) return 'google_error';
    if (!p.state) return 'mismatch';
    // Consume the state whatever happens next: it is single-use. The delete is conditional
    // (deleteMany + count), so of two callbacks racing with the same state exactly one wins;
    // the other is a mismatch, not a "record not found" crash.
    const row = await this.prisma.oAuthState.findUnique({ where: { stateHash: sha256(p.state) } });
    if (!row) return 'mismatch';
    const { count } = await this.prisma.oAuthState.deleteMany({ where: { id: row.id } });
    if (count === 0) return 'mismatch';
    if (row.expiresAt < new Date()) return 'expired';
    if (!p.nonce || !safeEqual(sha256(p.nonce), row.nonceHash)) return 'mismatch';
    if (p.error) return 'denied'; // the user clicked Cancel on Google's screen
    if (!p.code) return 'mismatch';

    try {
      const tokens = await this.oauth!.exchangeCode(p.code, row.codeVerifier);
      // Google lets the user untick a scope on its consent screen; without read access
      // there's nothing to do. (We never ask for more than read-only.)
      if (!tokens.scope.split(' ').includes(GMAIL_READONLY_SCOPE)) return 'scope';
      if (!tokens.refreshToken) return 'no_refresh_token';
      const { emailAddress } = await this.gmail.profile(tokens.accessToken);
      const sealed = this.box!.seal(tokens.refreshToken, row.userId);
      const data = {
        emailAddress,
        refreshTokenEnc: sealed,
        status: 'ACTIVE' as const,
        lastError: null,
        connectedAt: new Date(),
      };
      await this.prisma.gmailConnection.upsert({
        where: { userId: row.userId },
        create: { userId: row.userId, ...data },
        update: data,
      });
    } catch (err) {
      this.logger.warn(`Gmail connect failed: ${(err as Error).message}`);
      return 'google_error';
    }
    // First check right away, so the user sees whether the label exists. Best effort: the
    // schedule picks it up anyway if the queue is down.
    await this.queues.enqueueEmailCheck(row.userId).catch(() => undefined);
    return 'connected';
  }

  async checkNow(userId: string) {
    const c = await this.prisma.gmailConnection.findUnique({ where: { userId } });
    if (!c) throw new NotFoundException('Gmail is not connected');
    if (c.status !== 'ACTIVE') throw new ConflictException('Reconnect Gmail first');
    await this.queues.enqueueEmailCheck(userId);
    return { queued: true };
  }

  // Revokes the grant at Google too, so the token is dead everywhere — not just forgotten
  // here. Read history (metadata only) is kept so a reconnect doesn't re-read old alerts.
  async disconnect(userId: string): Promise<void> {
    const c = await this.prisma.gmailConnection.findUnique({ where: { userId } });
    if (!c) return;
    if (this.box && this.oauth) {
      try {
        await this.oauth.revoke(this.box.open(c.refreshTokenEnc, userId));
      } catch (err) {
        // Already revoked, or Google unreachable: still forget it locally; the user can
        // remove access at myaccount.google.com/permissions.
        this.logger.warn(`Revoking Gmail token failed: ${(err as Error).message}`);
      }
    }
    await this.prisma.gmailConnection.delete({ where: { userId } });
  }
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
