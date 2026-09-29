import { z } from 'zod';
import { NON_EMPTY_UPDATE_MESSAGE, PastDate, nonEmptyUpdate } from './common.schema.js';

export interface WorkDates {
  startDate: Date;
  endDate?: Date | null;
  isCurrent?: boolean;
}

// Shared by the create schema and the API's update path (which has to check the
// merged stored + incoming values, since a PATCH may only carry some of them).
// Returns a message, or null if the dates are consistent.
export function workDatesProblem({ startDate, endDate, isCurrent }: WorkDates): string | null {
  if (isCurrent && endDate) return 'A current role cannot have an end date';
  if (!isCurrent && !endDate) return 'Set an end date, or mark the role as current';
  if (endDate && endDate < startDate) return 'End date cannot be before start date';
  return null;
}

const fields = {
  company: z.string().trim().min(1, 'Company is required').max(100),
  title: z.string().trim().min(1, 'Title is required').max(100),
  startDate: PastDate,
  endDate: PastDate.nullable(),
  isCurrent: z.boolean(),
  location: z.string().trim().min(1).max(100).nullable(),
};

export const CreateWorkExperienceSchema = z
  .object({
    ...fields,
    endDate: fields.endDate.optional(),
    isCurrent: fields.isCurrent.default(false),
    location: fields.location.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const problem = workDatesProblem(data);
    if (problem) ctx.addIssue({ code: 'custom', path: ['endDate'], message: problem });
  });

export type CreateWorkExperienceInput = z.infer<typeof CreateWorkExperienceSchema>;

export const UpdateWorkExperienceSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine(nonEmptyUpdate, { message: NON_EMPTY_UPDATE_MESSAGE });

export type UpdateWorkExperienceInput = z.infer<typeof UpdateWorkExperienceSchema>;
