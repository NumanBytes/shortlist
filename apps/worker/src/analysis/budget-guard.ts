import { Injectable } from '@nestjs/common';
import { aiSettingsFromRow, type AiSettingsInput } from '@shortlist/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export type BudgetDecision = { allowed: true } | { allowed: false; reason: string };

const DAY_MS = 24 * 3600 * 1000;

// Budget guard (docs/ai-scoring.md §12.3). Checked before EVERY model call. Totals come from the
// AiUsage log, so the guard sees exactly what was spent — including calls whose output
// was rejected. With ANALYSIS_CONCURRENCY parallel calls, a burst can overshoot a cap by
// at most that many calls; the Console's prepaid balance is the hard stop behind this.
@Injectable()
export class BudgetGuard {
  constructor(private readonly prisma: PrismaService) {}

  async settingsFor(userId: string): Promise<AiSettingsInput> {
    const row = await this.prisma.aiSettings.findUnique({ where: { userId } });
    return aiSettingsFromRow(row);
  }

  async monthToDateUsd(userId: string, now = new Date()): Promise<number> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const sum = await this.prisma.aiUsage.aggregate({
      where: { userId, createdAt: { gte: monthStart } },
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
    if (spent >= settings.monthlyBudgetUsd) {
      return {
        allowed: false,
        reason: `Monthly AI budget reached ($${spent.toFixed(2)} of $${settings.monthlyBudgetUsd.toFixed(2)})`,
      };
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
