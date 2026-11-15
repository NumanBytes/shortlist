import { PLANS, planLimitReason, planPeriodStart, planResetsAt } from './plans.js';

describe('plans', () => {
  const created = new Date('2026-09-03T10:00:00Z');
  const now = new Date('2026-11-16T12:00:00Z');

  it('counts a trial from the account’s creation, forever', () => {
    expect(planPeriodStart('FREE', created, now)).toEqual(created);
    expect(planResetsAt('FREE', now)).toBeNull();
  });

  it('counts paid plans per calendar month in UTC', () => {
    expect(planPeriodStart('STARTER', created, now)).toEqual(new Date('2026-11-01T00:00:00Z'));
    expect(planResetsAt('PRO', now)).toEqual(new Date('2026-12-01T00:00:00Z'));
    expect(planResetsAt('PRO', new Date('2026-12-31T23:00:00Z'))).toEqual(new Date('2027-01-01T00:00:00Z'));
  });

  it('says which limit was reached in words a user knows', () => {
    expect(planLimitReason('FREE', 'tailoredResumes')).toBe("You've used the 5 tailored resumes in the free trial");
    expect(planLimitReason('STARTER', 'scoredJobs')).toBe("You've used your 300 jobs scored this month (Starter)");
  });

  // The dollar budget is a safety stop above the units, at measured costs (§12.2):
  // ≈ $0.006 a scored job and $0.03 a tailored resume.
  it('gives each plan a dollar budget that covers its units', () => {
    for (const p of Object.values(PLANS)) {
      expect(p.scoredJobs * 0.006 + p.tailoredResumes * 0.03).toBeLessThan(p.monthlyBudgetUsd);
    }
  });

  it('keeps on-demand runs to Pro', () => {
    expect(
      Object.entries(PLANS)
        .filter(([, p]) => p.runNow)
        .map(([k]) => k),
    ).toEqual(['PRO']);
  });
});
