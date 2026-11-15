import { z } from 'zod';

// Plans (hosted Shortlist, Agents.md §2.1; docs/ai-scoring.md §12.5). Limits are in what a user
// understands — jobs scored, resumes tailored — never in dollars. Behind them, each account's
// dollar budget and the server-wide cap (§12.3) stay as safety stops.
//
// Until payments exist (roadmap phase 4), an admin assigns the plan.
export const PlanName = z.enum(['FREE', 'STARTER', 'PRO']);
export type PlanName = z.infer<typeof PlanName>;

export interface Plan {
  label: string;
  priceUsdPerMonth: number;
  // 'trial': counted once, from the account's creation, never reset. 'month': per calendar
  // month (UTC) — a billing period once payments exist.
  period: 'trial' | 'month';
  scoredJobs: number; // job analyses (Haiku), automatic or asked for
  tailoredResumes: number; // tailoring calls (Sonnet); reusing an approved resume is free
  // How often the nightly discovery checks this account's sources.
  discoveryEveryDays: number;
  // "Find new jobs" on demand (within the per-source cooldown, docs/discovery.md §9.9).
  runNow: boolean;
  // The account's monthly AI dollar budget when an admin assigns the plan: a safety stop
  // above the units, from measured costs (≈ $0.006 a scored job, $0.03 a resume, plus
  // alert emails and careers pages).
  monthlyBudgetUsd: number;
}

export const PLANS: Record<PlanName, Plan> = {
  // Finding and tracking jobs stay free for good; the AI is a one-time trial.
  FREE: {
    label: 'Free',
    priceUsdPerMonth: 0,
    period: 'trial',
    scoredJobs: 50,
    tailoredResumes: 5,
    discoveryEveryDays: 2,
    runNow: false,
    monthlyBudgetUsd: 1,
  },
  STARTER: {
    label: 'Starter',
    priceUsdPerMonth: 5,
    period: 'month',
    scoredJobs: 300,
    tailoredResumes: 25,
    discoveryEveryDays: 1,
    runNow: false,
    monthlyBudgetUsd: 4,
  },
  PRO: {
    label: 'Pro',
    priceUsdPerMonth: 20,
    period: 'month',
    scoredJobs: 1000,
    tailoredResumes: 100,
    discoveryEveryDays: 1,
    runNow: true,
    monthlyBudgetUsd: 12,
  },
};

export type PlanUnit = 'scoredJobs' | 'tailoredResumes';

// Where the plan's count starts: the account's creation for a trial, else this month (UTC).
export function planPeriodStart(plan: PlanName, accountCreatedAt: Date, now = new Date()): Date {
  return PLANS[plan].period === 'trial'
    ? accountCreatedAt
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// When the count starts again, or null for a trial (it never does).
export function planResetsAt(plan: PlanName, now = new Date()): Date | null {
  return PLANS[plan].period === 'trial' ? null : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

const UNIT_WORDS: Record<PlanUnit, [string, string]> = {
  scoredJobs: ['job scored', 'jobs scored'],
  tailoredResumes: ['tailored resume', 'tailored resumes'],
};

// The reason shown on a deferred job or a refused request, e.g. "You've used your 25 tailored
// resumes this month (Starter)".
export function planLimitReason(plan: PlanName, unit: PlanUnit): string {
  const p = PLANS[plan];
  const n = p[unit];
  const words = UNIT_WORDS[unit][n === 1 ? 0 : 1];
  return p.period === 'trial'
    ? `You've used the ${n} ${words} in the free trial`
    : `You've used your ${n} ${words} this month (${p.label})`;
}

// The model-call purpose that counts toward each unit (AiUsage.purpose).
export const PLAN_UNIT_PURPOSE: Record<PlanUnit, 'ANALYZE_JOB' | 'TAILOR_RESUME'> = {
  scoredJobs: 'ANALYZE_JOB',
  tailoredResumes: 'TAILOR_RESUME',
};

// Admin: assign a plan (PUT /admin/users/:id/plan).
export const SetPlanSchema = z.object({ plan: PlanName }).strict();
export type SetPlanInput = z.infer<typeof SetPlanSchema>;

// A refused request: HTTP 402 with this code, so the web app can offer the plans.
export const PLAN_LIMIT_CODE = 'PLAN_LIMIT';
