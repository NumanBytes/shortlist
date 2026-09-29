import { z } from 'zod';
import { NON_EMPTY_UPDATE_MESSAGE, PastDate, WebUrl, nonEmptyUpdate } from './common.schema.js';

export function projectDatesProblem(d: { startDate?: Date | null; endDate?: Date | null }): string | null {
  if (d.startDate && d.endDate && d.endDate < d.startDate) return 'End date cannot be before start date';
  return null;
}

const fields = {
  name: z.string().trim().min(1, 'Project name is required').max(100),
  description: z.string().trim().min(1).max(2000).nullable(),
  liveUrl: WebUrl.nullable(),
  repoUrl: WebUrl.nullable(),
  isShipped: z.boolean(),
  startDate: PastDate.nullable(),
  endDate: PastDate.nullable(),
};

export const CreateProjectSchema = z
  .object({
    name: fields.name,
    description: fields.description.optional(),
    liveUrl: fields.liveUrl.optional(),
    repoUrl: fields.repoUrl.optional(),
    isShipped: fields.isShipped.default(false),
    startDate: fields.startDate.optional(),
    endDate: fields.endDate.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const problem = projectDatesProblem(data);
    if (problem) ctx.addIssue({ code: 'custom', path: ['endDate'], message: problem });
  });

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine(nonEmptyUpdate, { message: NON_EMPTY_UPDATE_MESSAGE });

export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
