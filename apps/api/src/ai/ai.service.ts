import { Injectable } from '@nestjs/common';
import { DEFAULT_AI_SETTINGS, type AiSettingsInput, type UpdateAiSettingsInput } from '@shortlist/shared';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 24 * 3600 * 1000;

// What the user sees about AI spend and the budget guard (Agents.md §12.3). The worker's
// BudgetGuard enforces the same numbers from the same AiUsage rows.
@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  async settings(userId: string): Promise<AiSettingsInput> {
    const row = await this.prisma.aiSettings.findUnique({ where: { userId } });
    return row
      ? { maxAnalysesPerDay: row.maxAnalysesPerDay, monthlyBudgetUsd: Number(row.monthlyBudgetUsd) }
      : DEFAULT_AI_SETTINGS;
  }

  async updateSettings(userId: string, input: UpdateAiSettingsInput): Promise<AiSettingsInput> {
    const current = await this.settings(userId);
    const next = { ...current, ...input };
    await this.prisma.aiSettings.upsert({ where: { userId }, create: { userId, ...next }, update: next });
    return next;
  }

  async usage(userId: string, now = new Date()) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [settings, month, analysesLast24h, byStatus] = await Promise.all([
      this.settings(userId),
      this.prisma.aiUsage.aggregate({
        where: { userId, createdAt: { gte: monthStart } },
        _sum: { costUsd: true },
        _count: true,
      }),
      this.prisma.aiUsage.count({
        where: { userId, purpose: 'ANALYZE_JOB', createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
      }),
      this.prisma.job.groupBy({ by: ['analysisStatus'], where: { userId }, _count: true }),
    ]);
    const jobs = Object.fromEntries(byStatus.map((g) => [g.analysisStatus, g._count]));
    return {
      settings,
      monthToDateUsd: Number(month._sum.costUsd ?? 0),
      callsThisMonth: month._count,
      analysesLast24h,
      jobs: { pending: jobs.PENDING ?? 0, done: jobs.DONE ?? 0, deferred: jobs.DEFERRED ?? 0, failed: jobs.FAILED ?? 0 },
    };
  }
}
