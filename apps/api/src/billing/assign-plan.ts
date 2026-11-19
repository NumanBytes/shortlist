import { PLANS, aiSettingsFromRow, type PlanName } from '@shortlist/shared';
import type { Prisma } from '@shortlist/db';

// Gives an account a plan and sets its monthly AI budget to the plan's safety stop
// (docs/ai-scoring.md §12.5). One place for both writers: an admin assigning a plan and a payment
// webhook changing one (docs/billing.md §20). Runs inside the caller's transaction.
export async function assignPlan(tx: Prisma.TransactionClient, userId: string, plan: PlanName) {
  const row = await tx.aiSettings.findUnique({ where: { userId } });
  const settings = { ...aiSettingsFromRow(row), monthlyBudgetUsd: PLANS[plan].monthlyBudgetUsd };
  await tx.user.update({ where: { id: userId }, data: { plan } });
  await tx.aiSettings.upsert({ where: { userId }, create: { userId, ...settings }, update: settings });
  return { plan, monthlyBudgetUsd: settings.monthlyBudgetUsd };
}
