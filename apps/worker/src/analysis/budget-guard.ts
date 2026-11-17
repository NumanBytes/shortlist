import { Inject, Injectable, Optional } from '@nestjs/common';
import { aiSettingsFromRow, type AiSettingsInput } from '@shortlist/shared';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { Notifier } from '../notifications/notifier.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type BudgetDecision = { allowed: true } | { allowed: false; reason: string };

const DAY_MS = 24 * 3600 * 1000;

// Budget guard (docs/ai-scoring.md §12.3). Checked before EVERY model call. Totals come from the
// AiUsage log, so the guard sees exactly what was spent — including calls whose output
// was rejected. With ANALYSIS_CONCURRENCY parallel calls, a burst can overshoot a cap by
// at most that many calls; the Console's prepaid balance is the hard stop behind this.
//
// Two caps, both checked before every call (Agents.md §2.1): the user's own monthly budget
// (set by an admin), and AI_SERVER_MONTHLY_BUDGET_USD across every account, since one
// Anthropic key pays for all of them. Either one reached → the work waits (DEFERRED).
@Injectable()
export class BudgetGuard {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifier?: Notifier,
    @Optional() @Inject(ENV) private readonly env?: Pick<Env, 'AI_SERVER_MONTHLY_BUDGET_USD'>,
  ) {}

  async settingsFor(userId: string): Promise<AiSettingsInput> {
    const row = await this.prisma.aiSettings.findUnique({ where: { userId } });
    return aiSettingsFromRow(row);
  }

  // One user's spend this month, or — with no user — the whole server's.
  async monthToDateUsd(userId: string | null, now = new Date()): Promise<number> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const sum = await this.prisma.aiUsage.aggregate({
      where: { ...(userId && { userId }), createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
    });
    return Number(sum._sum.costUsd ?? 0);
  }

  async analysesLastDay(userId: string, now = new Date()): Promise<number> {
    return this.prisma.aiUsage.count({
      where: { userId, purpose: 'ANALYZE_JOB', createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
    });
  }

  // The monthly cap applies to every model call. Tailoring checks only this: it's started by
  // the user one job at a time, so the daily analysis cap doesn't apply to it.
  async checkMonthly(userId: string, now = new Date()): Promise<BudgetDecision> {
    const settings = await this.settingsFor(userId);
    const spent = await this.monthToDateUsd(userId, now);
    const month = now.toISOString().slice(0, 7);
    if (spent >= settings.monthlyBudgetUsd) {
      const reason = `Monthly AI budget reached ($${spent.toFixed(2)} of $${settings.monthlyBudgetUsd.toFixed(2)})`;
      // Once a month: scoring and tailoring wait until the month turns (or an admin raises it).
      await this.notifier?.problem(
        userId,
        `budget:${month}`,
        'AI budget reached',
        `${reason}. New jobs wait unscored until the month turns. Finding and tracking jobs carry on.`,
        '/profile',
      );
      return { allowed: false, reason };
    }
    const serverCap = this.env?.AI_SERVER_MONTHLY_BUDGET_USD;
    if (serverCap !== undefined && (await this.monthToDateUsd(null, now)) >= serverCap) {
      // Not the user's doing, so the message doesn't blame their budget, and it never says
      // what the server spent.
      const reason = "Shortlist's AI allowance for this month is used up";
      await this.notifier?.problem(
        userId,
        `server-budget:${month}`,
        'AI paused for this month',
        `${reason}. New jobs wait unscored until it resets. Finding and tracking jobs carry on.`,
        '/profile',
      );
      return { allowed: false, reason };
    }
    return { allowed: true };
  }

  async checkAnalysis(userId: string, now = new Date()): Promise<BudgetDecision> {
    const monthly = await this.checkMonthly(userId, now);
    if (!monthly.allowed) return monthly;
    const settings = await this.settingsFor(userId);
    const today = await this.analysesLastDay(userId, now);
    if (today >= settings.maxAnalysesPerDay) {
      return { allowed: false, reason: `Daily analysis cap reached (${today} of ${settings.maxAnalysesPerDay})` };
    }
    return { allowed: true };
  }
}
