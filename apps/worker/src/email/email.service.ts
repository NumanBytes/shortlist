import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ANALYSIS_QUEUE, EmailExtractionSchema, costUsd, emailSourceKey } from '@shortlist/shared';
import { GoogleApiError, SecretBox, type GmailApi, type GoogleOAuth } from '@shortlist/shared/node';
import type { Queue } from 'bullmq';
import { enqueueAnalyses } from '../analysis/analysis.processor.js';
import { BudgetGuard } from '../analysis/budget-guard.js';
import { OutOfCreditError, PermanentAnalyzerError } from '../analysis/job-analyzer.js';
import { parseModelOutput } from '../analysis/model-output.js';
import { compileFilter } from '../discovery/filter.js';
import { storeJobs } from '../discovery/job-store.js';
import { loadPreferences } from '../discovery/preferences.js';
import type { Posting } from '../discovery/types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { portalFor, toAlertEmail, type AlertEmail, type EmailParser, type EmailPosting } from './alert-email.js';
import { EMAIL_EXTRACTOR, buildExtractionPrompt, checkExtracted, type EmailExtractor } from './extract.js';
import { indeedParser } from './parsers/indeed.js';

export const WORKER_GOOGLE_OAUTH = Symbol('WORKER_GOOGLE_OAUTH');
export const WORKER_GMAIL_API = Symbol('WORKER_GMAIL_API');
export const SECRET_BOX = Symbol('SECRET_BOX');

// Code parsers, only where a sender's volume justifies one (docs/email-alerts.md §10.4). Every other
// sender is read by the model fallback.
export const EMAIL_PARSERS: EmailParser[] = [indeedParser];

// Labelled mail that is obviously not an alert — skipped without a model call.
const NOT_ALERT_SUBJECT =
  /your application (was|has been) (sent|viewed|received|submitted)|application (received|submitted|viewed)|verify your (email|account)|password reset|security alert|sign-in attempt/i;

// A failure retrying can't fix (grant revoked, label missing). The processor maps it to
// UnrecoverableError; the reason is already on the connection for the user to see.
export class PermanentEmailError extends Error {}

export type CheckOutcome =
  | { status: 'SUCCESS' | 'EMPTY'; read: number; jobsNew: number }
  | { status: 'SKIPPED'; reason: string };

type Reading = (
  | { status: 'PARSED'; parser: string; postings: EmailPosting[]; note: string | null }
  | { status: 'NOT_ALERT'; parser: string | null; note: string }
  | { status: 'DEFERRED' | 'FAILED'; parser: string | null; note: string }
) & { parserFailed?: true }; // a code parser found nothing and the model was asked instead

// First check looks back this far; later checks overlap the previous one by a margin
// (Gmail's `after:` is day-granular) and skip what was already read.
const FIRST_LOOKBACK = 'newer_than:30d';
const OVERLAP_MS = 2 * 24 * 3600 * 1000;
const MAX_MESSAGES = 300; // per check — a backlog is worked through over several checks

// Reads new mail under the user's Shortlist label (docs/email-alerts.md §10). Only that label is ever
// queried; bodies are processed in memory and never stored.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: BudgetGuard,
    @Inject(WORKER_GOOGLE_OAUTH) private readonly oauth: GoogleOAuth | null,
    @Inject(WORKER_GMAIL_API) private readonly gmail: GmailApi,
    @Inject(SECRET_BOX) private readonly box: SecretBox | null,
    @Inject(EMAIL_EXTRACTOR) private readonly extractor: EmailExtractor,
    @InjectQueue(ANALYSIS_QUEUE) private readonly analysisQueue: Queue,
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

    const known = await this.prisma.emailMessage.findMany({ where: { userId, gmailMessageId: { in: ids } }, select: { gmailMessageId: true } });
    const seen = new Set(known.map((m) => m.gmailMessageId));
    // Deferred messages (budget, no API key) and ones read before parsing existed are read
    // again by id — they may be older than this check's window.
    const retry = (
      await this.prisma.emailMessage.findMany({ where: { userId, status: { in: ['DEFERRED', 'UNPARSED'] } }, select: { gmailMessageId: true } })
    ).map((m) => m.gmailMessageId);
    const toRead = [...new Set([...ids.filter((id) => !seen.has(id)), ...retry])].slice(0, MAX_MESSAGES);

    const byPortal = new Map<string, { label: string; postings: EmailPosting[]; emails: number }>();
    for (const id of toRead) {
      // Body read in memory only: parsed, then dropped.
      const m = await this.gmail.getMessage(accessToken, id, 'raw');
      const email = toAlertEmail(Buffer.from(m.raw ?? '', 'base64url'), new Date(Number(m.internalDate)));
      const { portal, label: portalLabel } = portalFor(email.sender);
      const r = await this.read(userId, email, portalLabel);
      const data = {
        sender: email.sender,
        receivedAt: email.receivedAt,
        portal,
        status: r.status,
        parser: r.parser,
        note: r.note?.slice(0, 500) ?? null,
        parserFailed: r.parserFailed ?? false,
        jobsFound: r.status === 'PARSED' ? r.postings.length : 0,
        error: null,
      };
      await this.prisma.emailMessage.upsert({
        where: { userId_gmailMessageId: { userId, gmailMessageId: id } },
        create: { userId, gmailMessageId: id, ...data },
        update: { ...data, readAt: new Date() },
      });
      if (r.status === 'PARSED') {
        const p = byPortal.get(portal) ?? { label: portalLabel, postings: [], emails: 0 };
        p.postings.push(...r.postings);
        p.emails++;
        byPortal.set(portal, p);
      }
    }

    // Each portal's jobs go through the same title/location filter and dedupe as board
    // discovery, recorded as a run against that portal's EMAIL_INBOX source.
    let jobsNew = 0;
    const toAnalyse: string[] = [];
    const filter = byPortal.size ? compileFilter(await loadPreferences(this.prisma, userId)) : null;
    for (const [portal, p] of byPortal) {
      const r = await this.storePortal(userId, portal, p.label, p.postings, filter!);
      jobsNew += r.newJobIds.length;
      toAnalyse.push(...r.newJobIds, ...r.completedJobIds);
    }
    if (toAnalyse.length) {
      // Best effort, like discovery: the nightly sweep picks up anything left PENDING.
      await enqueueAnalyses(this.analysisQueue, toAnalyse, `email-${userId}-${startedAt.getTime()}`).catch((err: Error) =>
        this.logger.warn(`Couldn't queue ${toAnalyse.length} email jobs for analysis: ${err.message}`),
      );
    }

    const status = toRead.length === 0 ? 'EMPTY' : 'SUCCESS';
    await this.prisma.gmailConnection.update({
      where: { userId },
      data: { lastCheckedAt: startedAt, lastCheckStatus: status, lastCheckFound: toRead.length, lastError: null },
    });
    this.logger.log(`Gmail ${c.emailAddress}: ${status} — ${toRead.length} message(s) read, ${jobsNew} new job(s)`);
    return { status, read: toRead.length, jobsNew };
  }

  // One email → jobs. A code parser if the sender has one; the model otherwise, or when the
  // parser finds nothing in what should be an alert (it may be out of date).
  private async read(userId: string, email: AlertEmail, portalLabel: string): Promise<Reading> {
    if (NOT_ALERT_SUBJECT.test(email.subject)) return { status: 'NOT_ALERT', parser: null, note: 'not a job alert (subject)' };

    const parser = email.sender ? EMAIL_PARSERS.find((p) => p.matches(email.sender!)) : undefined;
    if (!parser) return this.readWithModel(userId, email, portalLabel, null);
    let fallback: string;
    try {
      const r = parser.parse(email);
      if (r.kind === 'not_alert') return { status: 'NOT_ALERT', parser: parser.portal, note: r.reason };
      if (r.postings.length > 0) return { status: 'PARSED', parser: parser.portal, postings: r.postings, note: null };
      fallback = `${portalLabel} parser found no jobs — read by AI instead; the parser may be out of date`;
    } catch (err) {
      fallback = `${portalLabel} parser failed (${(err as Error).message}) — read by AI instead`;
    }
    return { ...(await this.readWithModel(userId, email, portalLabel, fallback)), parserFailed: true };
  }

  // The model fallback (docs/email-alerts.md §10.4). `note` explains why a code parser didn't answer.
  private async readWithModel(userId: string, email: AlertEmail, portalLabel: string, note: string | null): Promise<Reading> {
    if (!this.extractor.configured) return { status: 'DEFERRED', parser: null, note: 'ANTHROPIC_API_KEY is not set in the worker' };
    const guard = await this.budget.checkMonthly(userId);
    if (!guard.allowed) return { status: 'DEFERRED', parser: null, note: guard.reason };

    const prompt = buildExtractionPrompt(email);
    let result;
    try {
      result = await this.extractor.extract(prompt);
    } catch (err) {
      if (err instanceof OutOfCreditError) return { status: 'DEFERRED', parser: null, note: err.message };
      if (err instanceof PermanentAnalyzerError) return { status: 'FAILED', parser: 'ai', note: err.message };
      throw err; // transient: the check retries; messages already recorded aren't read twice
    }

    // Log the spend before using the output: the call was billed either way.
    const parsed = parseModelOutput(result.text, result.stopReason, EmailExtractionSchema, 'read this email');
    await this.prisma.aiUsage.create({
      data: {
        userId,
        purpose: 'EXTRACT_EMAIL',
        model: result.model,
        ...result.usage,
        costUsd: costUsd(result.model, result.usage),
        succeeded: parsed.ok,
      },
    });
    if (!parsed.ok) return { status: 'FAILED', parser: 'ai', note: parsed.reason };
    if (!parsed.value.isJobEmail) return { status: 'NOT_ALERT', parser: 'ai', note: note ?? 'not a job alert' };

    const { postings, dropped } = checkExtracted(parsed.value, email, prompt.refs);
    if (dropped.length) this.logger.warn(`${portalLabel}: dropped ${dropped.length} extracted job(s): ${dropped.map((d) => d.reason).join(', ')}`);
    return { status: 'PARSED', parser: 'ai', postings, note };
  }

  private async storePortal(userId: string, portal: string, label: string, postings: EmailPosting[], filter: ReturnType<typeof compileFilter>) {
    // The seeded email_alerts:<portal> row when there is one, else created on first use.
    // EMAIL_INBOX sources are never run by the discovery fan-out.
    const key = emailSourceKey(portal);
    const source = await this.prisma.jobSource.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, name: label, type: 'EMAIL_INBOX', config: { provider: 'email_alerts', note: 'Read from job-alert emails in Gmail' }, isEnabled: false },
      update: {},
    });
    const run = await this.prisma.discoveryRun.create({ data: { jobSourceId: source.id, status: 'RUNNING' } });

    const matched = postings
      .map((p): Posting => ({ ...p, externalId: p.externalId ?? p.url, description: null }))
      // Stage A as for boards (posting age not enforced: an alert is new by definition), then
      // the summary stage: no description, so a software-role title or a stack keyword in
      // the title or summary (docs/email-alerts.md §10.5).
      .filter((p) => {
        const snippet = postings.find((e) => e.url === p.url)?.snippet ?? '';
        return filter.screenListing(p, { enforceMaxAge: false }).pass && filter.screenSummary(p, snippet).pass;
      });
    const items = matched.map((p) => {
      const snippet = postings.find((e) => e.url === p.url)?.snippet;
      return { posting: p, description: snippet ? `From the ${label} alert: ${snippet}` : '', partial: true };
    });
    const stored = await storeJobs(this.prisma, { userId, jobSourceId: source.id, discoveryRunId: run.id, provider: portal }, items);

    const now = new Date();
    const status = postings.length === 0 ? 'EMPTY' : 'SUCCESS';
    await this.prisma.$transaction([
      this.prisma.discoveryRun.update({
        where: { id: run.id },
        data: { status, finishedAt: now, jobsFound: postings.length, jobsMatched: matched.length, jobsNew: stored.newJobIds.length },
      }),
      this.prisma.jobSource.update({ where: { id: source.id }, data: { lastRunAt: now, lastRunStatus: status } }),
    ]);
    return stored;
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
