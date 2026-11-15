import { HttpException, HttpStatus } from '@nestjs/common';
import {
  PLANS,
  PLAN_LIMIT_CODE,
  PLAN_UNIT_PURPOSE,
  planLimitReason,
  planPeriodStart,
  planResetsAt,
  type PlanName,
  type PlanUnit,
} from '@shortlist/shared';
import type { PrismaService } from '../prisma/prisma.service.js';

// The user's plan and what they've used of it (docs/ai-scoring.md §12.5). Counted the way the
// worker's BudgetGuard.checkPlan() counts — successful model calls in the plan's period — so
// what the app shows is what the worker enforces.
export async function planUsage(prisma: PrismaService, userId: string, now = new Date()) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true, createdAt: true } });
  const plan = PLANS[user.plan];
  const since = planPeriodStart(user.plan, user.createdAt, now);
  const count = (unit: PlanUnit) =>
    prisma.aiUsage.count({
      where: { userId, purpose: PLAN_UNIT_PURPOSE[unit], succeeded: true, createdAt: { gte: since } },
    });
  const [scored, tailored] = await Promise.all([count('scoredJobs'), count('tailoredResumes')]);
  return {
    name: user.plan,
    label: plan.label,
    priceUsdPerMonth: plan.priceUsdPerMonth,
    period: plan.period,
    resetsAt: planResetsAt(user.plan, now),
    runNow: plan.runNow,
    discoveryEveryDays: plan.discoveryEveryDays,
    scoredJobs: { used: scored, limit: plan.scoredJobs },
    tailoredResumes: { used: tailored, limit: plan.tailoredResumes },
  };
}

// 402 Payment Required with PLAN_LIMIT: the request is fine, the plan doesn't cover it. Not 403,
// which the app uses for "verify your email" and which must never mean "pay".
export function planLimitError(plan: PlanName, message: string): HttpException {
  return new HttpException({ statusCode: 402, message, code: PLAN_LIMIT_CODE, plan }, HttpStatus.PAYMENT_REQUIRED);
}

// Refuses work the plan has no units left for — before it's queued, so the user hears at once
// instead of finding it deferred later. The worker checks again when it runs.
export async function assertPlanAllows(prisma: PrismaService, userId: string, unit: PlanUnit) {
  const usage = await planUsage(prisma, userId);
  if (usage[unit].used >= usage[unit].limit) throw planLimitError(usage.name, planLimitReason(usage.name, unit));
}
