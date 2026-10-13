import { Inject, Injectable, Logger } from '@nestjs/common';
import { CareersPageExtractionSchema, costUsd } from '@shortlist/shared';
import { createHash } from 'node:crypto';
import { BudgetGuard } from '../../analysis/budget-guard.js';
import { OutOfCreditError, PermanentAnalyzerError } from '../../analysis/job-analyzer.js';
import { parseModelOutput } from '../../analysis/model-output.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PermanentSourceError } from '../errors.js';
import { jsonLdDescription } from '../html.js';
import { getPublicText, getText } from '../http.js';
import { mapPostings } from '../postings.js';
import type { AdapterContext, Posting } from '../types.js';
import { checkOpenings, type Opening } from './check.js';
import { CAREERS_PAGE_EXTRACTOR, buildCareersPagePrompt, type CareersPageExtractor } from './extractor.js';
import { fingerprint, mainText, pageText } from './page.js';

export interface CareersPageSource {
  sourceId: string;
  userId: string;
  name: string;
  url: string;
}

// Milestone 3 (docs/discovery.md §9.14): one reader for every company's own careers page,
// instead of a hand-written scraper per site that breaks on each redesign. The cheap check
// sits in front of the expensive one: every night the page is fetched and fingerprinted
// (free); only when the fingerprint changed does Haiku read it (a fraction of a cent).
@Injectable()
export class CareersPageService {
  private readonly logger = new Logger(CareersPageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: BudgetGuard,
    @Inject(CAREERS_PAGE_EXTRACTOR) private readonly extractor: CareersPageExtractor,
  ) {}

  async read(source: CareersPageSource, ctx: AdapterContext): Promise<Posting[]> {
    const page = pageText(await getText(source.url), source.url);
    if (page.text.split(/\s+/).length < 20) {
      throw new PermanentSourceError('The page has almost no text without JavaScript — it can’t be read this way');
    }
    const hash = fingerprint(page);
    const snapshot = await this.prisma.careersPageSnapshot.findUnique({ where: { jobSourceId: source.sourceId } });
    const last = snapshot?.extractedAt ? (snapshot.openings as unknown as Opening[]) : null;
    if (last && snapshot!.contentHash === hash) return this.postings(source, last, ctx);
    // Unchanged since a reading failed: reading it again would fail the same way and cost again.
    if (snapshot?.failedHash === hash) {
      throw new PermanentSourceError(`Unchanged since its last reading failed (${snapshot.failure}) — not re-read`);
    }

    // Changed (or never read). Reading costs money, so the same rules as every model call:
    // configured, under budget, logged before its output is used. Work over budget is
    // deferred, never dropped — the old reading stays, so a later run tries again.
    const deferred = (reason: string) => {
      if (last) {
        this.logger.warn(`${source.name}: page changed but not re-read (${reason}); using the last reading`);
        return this.postings(source, last, ctx);
      }
      throw new PermanentSourceError(`Page not read yet: ${reason}`);
    };
    if (!this.extractor.configured) return deferred('ANTHROPIC_API_KEY is not set in the worker');
    const guard = await this.budget.checkMonthly(source.userId);
    if (!guard.allowed) return deferred(guard.reason);

    let result;
    try {
      result = await this.extractor.extract(buildCareersPagePrompt(source.name, page));
    } catch (err) {
      if (err instanceof OutOfCreditError) return deferred(err.message);
      if (err instanceof PermanentAnalyzerError) return this.failed(source, hash, err.message);
      throw err; // transient: the queue retries
    }
    const parsed = parseModelOutput(result.text, result.stopReason, CareersPageExtractionSchema, 'read this page');
    await this.prisma.aiUsage.create({
      data: {
        userId: source.userId,
        purpose: 'EXTRACT_CAREERS_PAGE',
        model: result.model,
        ...result.usage,
        costUsd: costUsd(result.model, result.usage),
        succeeded: parsed.ok,
      },
    });
    if (!parsed.ok) return this.failed(source, hash, parsed.reason);

    const { openings, dropped } = checkOpenings(parsed.value, page, source.url);
    for (const d of dropped) this.logger.warn(`${source.name}: dropped "${d.title}" — ${d.reason}`);
    const data = {
      contentHash: hash,
      openings: openings as unknown as object,
      extractedAt: new Date(),
      failedHash: null,
      failure: null,
    };
    await this.prisma.careersPageSnapshot.upsert({
      where: { jobSourceId: source.sourceId },
      create: { jobSourceId: source.sourceId, ...data },
      update: data,
    });
    this.logger.log(`${source.name}: page changed — read ${openings.length} openings`);
    return this.postings(source, openings, ctx);
  }

  // A reading that failed is remembered by fingerprint (the page's last good reading is kept),
  // then the run fails visibly — no queue retries, which would pay again.
  private async failed(source: CareersPageSource, hash: string, reason: string): Promise<never> {
    await this.prisma.careersPageSnapshot.upsert({
      where: { jobSourceId: source.sourceId },
      create: { jobSourceId: source.sourceId, contentHash: '', openings: [], failedHash: hash, failure: reason },
      update: { failedHash: hash, failure: reason },
    });
    throw new PermanentSourceError(reason);
  }

  // Through mapPostings, the validation boundary every adapter's postings pass (§9.3).
  private postings(source: CareersPageSource, openings: Opening[], ctx: AdapterContext): Posting[] {
    return mapPostings(openings, ctx, (o): Posting => {
      const ownPage = o.url !== source.url;
      return {
        // Stable across runs: the job's own page, or its title on the careers page.
        externalId: createHash('sha1')
          .update(ownPage ? o.url : `${source.url}#${o.title}`)
          .digest('hex')
          .slice(0, 20),
        title: o.title,
        company: source.name,
        location: o.location,
        workMode: o.workMode,
        url: o.url,
        postedAt: null,
        description: o.details ?? (ownPage ? null : ''),
        // The link came off a third-party page: fetched only if its host is public.
        loadDescription: ownPage
          ? async () => {
              const html = await getPublicText(o.url);
              return jsonLdDescription(html) ?? mainText(html);
            }
          : undefined,
      };
    });
  }
}
