import { z } from 'zod';
import { NON_EMPTY_UPDATE_MESSAGE, WebUrl, nonEmptyUpdate } from './common.schema.js';

// The resume header. All optional except name; clearing a field sends null.
export const UpdateProfileSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    headline: z.string().trim().max(120).nullable(),
    location: z.string().trim().max(100).nullable(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/, 'Use digits, spaces, +, ( ) and - only')
      .nullable(),
    linkedinUrl: WebUrl.nullable(),
    githubUrl: WebUrl.nullable(),
  })
  .partial()
  .strict()
  .refine(nonEmptyUpdate, { message: NON_EMPTY_UPDATE_MESSAGE });
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

const year = z.number().int().min(1950).max(2100);
const educationFields = {
  degree: z.string().trim().min(1, 'Degree is required').max(150),
  institution: z.string().trim().min(1, 'Institution is required').max(150),
  location: z.string().trim().max(100).nullable(),
  startYear: year.nullable(),
  endYear: year.nullable(), // null = in progress
};
const yearsInOrder = (d: { startYear?: number | null; endYear?: number | null }) =>
  !(d.startYear && d.endYear && d.endYear < d.startYear);

export const CreateEducationSchema = z
  .object({
    ...educationFields,
    location: educationFields.location.optional(),
    startYear: educationFields.startYear.optional(),
    endYear: educationFields.endYear.optional(),
  })
  .strict()
  .refine(yearsInOrder, { message: 'End year cannot be before start year', path: ['endYear'] });
export type CreateEducationInput = z.infer<typeof CreateEducationSchema>;

export const UpdateEducationSchema = z
  .object(educationFields)
  .partial()
  .strict()
  .refine(nonEmptyUpdate, { message: NON_EMPTY_UPDATE_MESSAGE })
  .refine(yearsInOrder, { message: 'End year cannot be before start year', path: ['endYear'] });
export type UpdateEducationInput = z.infer<typeof UpdateEducationSchema>;
