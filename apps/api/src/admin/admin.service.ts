import { Injectable, NotFoundException } from '@nestjs/common';
import { PLANS, aiSettingsFromRow, type PlanName } from '@shortlist/shared';
import { PrismaService } from '../prisma/prisma.service.js';

// What an admin of hosted Shortlist sees and controls (Agents.md §2.1): the accounts, what
// each spent on AI this month, and each one's monthly AI budget — which users can no longer
// raise themselves, since the server's Anthropic key pays for every call.
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async users(now = new Date()) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [users, spend] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          plan: true,
          createdAt: true,
          emailVerifiedAt: true,
          aiSettings: true,
        },
      }),
      this.prisma.aiUsage.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: monthStart } },
        _sum: { costUsd: true },
      }),
    ]);
    const spent = new Map(spend.map((s) => [s.userId, Number(s._sum.costUsd ?? 0)]));
    return users.map(({ aiSettings, ...u }) => ({
      ...u,
      monthlyBudgetUsd: aiSettingsFromRow(aiSettings).monthlyBudgetUsd,
      monthToDateUsd: spent.get(u.id) ?? 0,
    }));
  }

  // Assigns a plan (until payments exist, docs/ai-scoring.md §12.5) and sets the account's dollar
  // budget to the plan's safety stop; the budget can still be changed on its own afterwards.
  async setPlan(userId: string, plan: PlanName) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { aiSettings: true } });
    if (!user) throw new NotFoundException();
    const settings = { ...aiSettingsFromRow(user.aiSettings), monthlyBudgetUsd: PLANS[plan].monthlyBudgetUsd };
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { plan } }),
      this.prisma.aiSettings.upsert({ where: { userId }, create: { userId, ...settings }, update: settings }),
    ]);
    return { plan, monthlyBudgetUsd: settings.monthlyBudgetUsd };
  }

  // Sets one account's monthly AI budget. Writes a full settings row, so an account that had
  // none keeps the defaults for everything else.
  async setBudget(userId: string, monthlyBudgetUsd: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, aiSettings: true },
    });
    if (!user) throw new NotFoundException();
    const next = { ...aiSettingsFromRow(user.aiSettings), monthlyBudgetUsd };
    await this.prisma.aiSettings.upsert({ where: { userId }, create: { userId, ...next }, update: next });
    return next;
  }
}
