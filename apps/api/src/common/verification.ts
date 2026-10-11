import type { Prisma } from '@shortlist/db';

// Data for resetting evidence to unverified. Every write path that changes what a
// piece of evidence claims must apply this — see Agents.md §6 and CLAUDE.md.
export const UNVERIFIED = { isVerified: false, verifiedAt: null } satisfies Prisma.SkillEvidenceUpdateManyMutationInput;

// True if the PATCH actually changes any of `fields`. Compares by value: dates arrive
// as fresh Date objects, and a form resubmitting unchanged values shouldn't count.
export function claimChanged<T extends object>(fields: readonly (keyof T)[], input: Partial<T>, existing: T): boolean {
  return fields.some((f) => f in input && !sameValue(input[f], existing[f]));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}
