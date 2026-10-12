import { z } from 'zod';

// The user's own known false claims (docs/resume.md §13.8): terms a generated resume must
// never contain, everywhere or only in bullets about paid work.
export const NeverClaimScopeEnum = z.enum(['ANYWHERE', 'PAID_WORK']);
export type NeverClaimScope = z.infer<typeof NeverClaimScopeEnum>;

export const CreateNeverClaimSchema = z
  .object({
    term: z.string().trim().min(1, 'Enter the term to keep off your resume').max(60),
    scope: NeverClaimScopeEnum.default('ANYWHERE'),
    note: z.string().trim().min(1).max(300).nullable().optional(),
  })
  .strict();
export type CreateNeverClaimInput = z.infer<typeof CreateNeverClaimSchema>;
