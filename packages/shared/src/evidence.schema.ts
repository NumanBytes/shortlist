import { z } from 'zod';

export const EvidenceContext = z.enum(['COMMERCIAL', 'PERSONAL', 'ACADEMIC']);
export type EvidenceContext = z.infer<typeof EvidenceContext>;

export const EvidenceDepth = z.enum(['PRODUCTION', 'WORKING', 'MAINTENANCE', 'EXPOSURE']);
export type EvidenceDepth = z.infer<typeof EvidenceDepth>;

export const CreateSkillEvidenceSchema = z
  .object({
    skillId: z.string().uuid(),
    context: EvidenceContext,
    depth: EvidenceDepth,
    whatIDid: z.string().trim().min(1, 'Description of what you did is required'),
    lastUsed: z.coerce.date(),
    workExperienceId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    // isVerified is intentionally omitted — it can never be set from a request body.
  })
  .strict()
  .refine(
    (data) => !(data.workExperienceId && data.projectId),
    { message: 'Evidence cannot be linked to both a work experience and a project' },
  );

export type CreateSkillEvidenceInput = z.infer<typeof CreateSkillEvidenceSchema>;

export const UpdateSkillEvidenceSchema = z
  .object({
    context: EvidenceContext.optional(),
    depth: EvidenceDepth.optional(),
    whatIDid: z.string().trim().min(1).optional(),
    lastUsed: z.coerce.date().optional(),
    workExperienceId: z.string().uuid().nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    // isVerified is intentionally omitted.
  })
  .strict();

export type UpdateSkillEvidenceInput = z.infer<typeof UpdateSkillEvidenceSchema>;
