import { z } from 'zod';

// Mirrors the SkillCategory enum in the Prisma schema.
// Defined once here; the API, worker, and web app all import it.
export const SkillCategory = z.enum([
  'LANGUAGE',
  'FRAMEWORK',
  'LIBRARY',
  'DATABASE',
  'TOOL',
  'PLATFORM',
  'CONCEPT',
]);

export const CreateSkillSchema = z
  .object({
    name: z.string().trim().min(1, 'Skill name is required').max(60),
    category: SkillCategory,
  })
  .strict(); // reject unknown fields instead of silently dropping them

// The TypeScript type is derived from the schema — never written by hand.
export type CreateSkillInput = z.infer<typeof CreateSkillSchema>;

export const UpdateSkillSchema = CreateSkillSchema.partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update' });

export type UpdateSkillInput = z.infer<typeof UpdateSkillSchema>;
