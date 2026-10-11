import { z } from 'zod';

// What the model returns for one job-alert email no code parser handles (docs/email-alerts.md §10.4).
// Shape only: worker code then checks every job against the email itself before keeping it.
export const ExtractedWorkModeEnum = z.enum(['REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN']);

export const EmailExtractionSchema = z.object({
  isJobEmail: z.boolean(),
  jobs: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        company: z.string().min(1).max(200),
        location: z.string().max(200).nullable(),
        workMode: ExtractedWorkModeEnum,
        salary: z.string().max(150).nullable(),
        // A short reference ("L4") into the link list sent with the email — never a URL.
        link: z.string().max(10).nullable(),
      }),
    )
    .max(60),
});
export type EmailExtraction = z.infer<typeof EmailExtractionSchema>;

// Hand-written for the API's structured output, like the other model schemas; kept in sync
// with EmailExtractionSchema by a test.
export const EMAIL_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isJobEmail', 'jobs'],
  properties: {
    isJobEmail: { type: 'boolean' },
    jobs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'company', 'location', 'workMode', 'salary', 'link'],
        properties: {
          title: { type: 'string' },
          company: { type: 'string' },
          location: { type: ['string', 'null'] },
          workMode: { type: 'string', enum: ExtractedWorkModeEnum.options },
          salary: { type: ['string', 'null'] },
          link: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

// "Paste full description" (docs/email-alerts.md §10.5): the user supplies what the alert left out.
export const PasteDescriptionSchema = z
  .object({
    description: z.string().trim().min(200, 'Paste the whole job description (at least 200 characters)').max(50_000),
  })
  .strict();
export type PasteDescriptionInput = z.infer<typeof PasteDescriptionSchema>;
