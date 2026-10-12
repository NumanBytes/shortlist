import { z } from 'zod';
import { ExtractedWorkModeEnum } from './email.schema.js';

// What the model returns for one company careers page (docs/discovery.md §9.14). Shape only:
// worker code checks every job against the page itself before keeping it.
export const CareersPageExtractionSchema = z.object({
  // False for a page that lists no openings (an About page, "email HR", a blank app shell).
  listsOpenings: z.boolean(),
  jobs: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        location: z.string().max(200).nullable(),
        workMode: ExtractedWorkModeEnum,
        // A short reference ("L4") into the link list sent with the page — never a URL.
        link: z.string().max(10).nullable(),
        // Text copied from the page about this job, when the page itself describes it.
        details: z.string().max(4000).nullable(),
      }),
    )
    .max(80),
});
export type CareersPageExtraction = z.infer<typeof CareersPageExtractionSchema>;

// Hand-written for the API's structured output, like the other model schemas; kept in sync
// by a test.
export const CAREERS_PAGE_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['listsOpenings', 'jobs'],
  properties: {
    listsOpenings: { type: 'boolean' },
    jobs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'location', 'workMode', 'link', 'details'],
        properties: {
          title: { type: 'string' },
          location: { type: ['string', 'null'] },
          workMode: { type: 'string', enum: ExtractedWorkModeEnum.options },
          link: { type: ['string', 'null'] },
          details: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;
