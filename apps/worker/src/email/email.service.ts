import { Inject, Injectable, Logger } from '@nestjs/common';
import { GoogleApiError, SecretBox, headerValue, senderAddress, type GmailApi, type GoogleOAuth } from '@shortlist/shared/node';
import { PrismaService } from '../prisma/prisma.service.js';

export const WORKER_GOOGLE_OAUTH = Symbol('WORKER_GOOGLE_OAUTH');
export const WORKER_GMAIL_API = Symbol('WORKER_GMAIL_API');
export const SECRET_BOX = Symbol('SECRET_BOX');

// A failure retrying can't fix (grant revoked, label missing). The processor maps it to
// UnrecoverableError; the reason is already on the connection for the user to see.
export class PermanentEmailError extends Error {}

export type CheckOutcome =
  | { status: 'SUCCESS' | 'EMPTY'; read: number }
  | { status: 'SKIPPED'; reason: string };

// First check looks back this far; later checks overlap the previous one by a margin
// (Gmail's `after:` is day-granular) and skip what was already read.
const FIRST_LOOKBACK = 'newer_than:30d';
const OVERLAP_MS = 2 * 24 * 3600 * 1000;
const MAX_MESSAGES = 300; // per check — a backlog is worked through over several checks

// Reads new mail under the user's Shortlist label (Agents.md §10). Only that label is ever
// queried; bodies are processed in memory and never stored.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WORKER_GOOGLE_OAUTH) private readonly oauth: GoogleOAuth | null,
    @Inject(WORKER_GMAIL_API) private readonly gmail: GmailApi,
    @Inject(SECRET_BOX) private readonly box: SecretBox | null,
  ) {}

  async check(userId: string): Promise<CheckOutcome> {
    const c = await this.prisma.gmailConnection.findUnique({ where: { userId } });
    if (!c) return { status: 'SKIPPED', reason: 'Gmail not connected' };
    if (c.status !== 'ACTIVE') return { status: 'SKIPPED', reason: 'needs reconnecting' };
    if (!this.oauth || !this.box) {
      await this.failed(userId, 'Gmail is not configured in the worker (GOOGLE_* and TOKEN_ENCRYPTION_KEY)');
      throw new PermanentEmailError('Gmail not configured in the worker');
    }
    const startedAt = new Date();

    const accessToken = await this.accessToken(userId, c.refreshTokenEnc);
    const label = (await this.gmail.labels(accessToken)).find((l) => l.name.toLowerCase() === c.labelName.toLowerCase());
    if (!label) {
      const reason = `There's no "${c.labelName}" label in ${c.emailAddress} yet — create the Gmail filter that applies it to job alerts`;
      await this.failed(userId, reason);
      throw new PermanentEmailError(reason);
    }

    const query = c.lastCheckedAt ? `after:${Math.floor((c.lastCheckedAt.getTime() - OVERLAP_MS) / 1000)}` : FIRST_LOOKBACK;
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.gmail.listMessages(accessToken, { labelId: label.id, query, pageToken });
      ids.push(...page.messages.map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < MAX_MESSAGES);

    const seen = new Set(
      (await this.prisma.emailMessage.findMany({ where: { userId, gmailMessageId: { in: ids } }, select: { gmailMessageId: true } })).map(
        (m) => m.gmailMessageId,
      ),
    );
    const fresh = ids.filter((id) => !seen.has(id)).slice(0, MAX_MESSAGES);

    for (const id of fresh) {
      // Metadata only for now: who sent it and when. Portal parsers (next step) will read
      // the body in memory and turn it into jobs; until then a message is UNPARSED, and
      // the Sources page lists those senders so we know which portal to support first.
      const m = await this.gmail.getMessage(accessToken, id, 'metadata');
      await this.prisma.emailMessage.create({
        data: {
          userId,
          gmailMessageId: id,
          sender: senderAddress(headerValue(m, 'From')),
          receivedAt: new Date(Number(m.internalDate)),
          status: 'UNPARSED',
        },
      });
    }

    const status = fresh.length === 0 ? 'EMPTY' : 'SUCCESS';
    await this.prisma.gmailConnection.update({
      where: { userId },
      data: { lastCheckedAt: startedAt, lastCheckStatus: status, lastCheckFound: fresh.length, lastError: null },
    });
    this.logger.log(`Gmail ${c.emailAddress}: ${status} — ${fresh.length} new labelled message(s)`);
    return { status, read: fresh.length };
  }

  // Ids of every user with a working connection — for the scheduled fan-out.
  async activeUserIds(): Promise<string[]> {
    return (await this.prisma.gmailConnection.findMany({ where: { status: 'ACTIVE' }, select: { userId: true } })).map((c) => c.userId);
  }

  // The access token is minted per check and never stored. A revoked/expired grant (or a
  // token the current key can't decrypt) needs the user to reconnect — retrying won't help.
  private async accessToken(userId: string, sealed: string): Promise<string> {
    let refreshToken: string;
    try {
      refreshToken = this.box!.open(sealed, userId);
    } catch {
      await this.needsReconnect(userId, "The stored Google token can't be decrypted (was TOKEN_ENCRYPTION_KEY changed?) — reconnect Gmail");
      throw new PermanentEmailError('undecryptable token');
    }
    try {
      return await this.oauth!.refreshAccessToken(refreshToken);
    } catch (err) {
      if (err instanceof GoogleApiError && err.grantRevoked) {
        await this.needsReconnect(userId, 'Google access was revoked or expired — reconnect Gmail');
        throw new PermanentEmailError(err.message);
      }
      throw err; // network / 5xx: let the queue retry
    }
  }

  private async needsReconnect(userId: string, reason: string) {
    await this.prisma.gmailConnection.update({
      where: { userId },
      data: { status: 'NEEDS_RECONNECT', lastError: reason, lastCheckedAt: new Date(), lastCheckStatus: 'FAILED' },
    });
  }

  async failed(userId: string, reason: string) {
    await this.prisma.gmailConnection.updateMany({
      where: { userId },
      data: { lastError: reason.slice(0, 1000), lastCheckedAt: new Date(), lastCheckStatus: 'FAILED' },
    });
  }
}
