import { PermanentSourceError } from '../errors.js';
import type { Adapter } from '../types.js';

// A company's own careers page (Milestone 3, docs/discovery.md §9.14). Unlike the platform
// adapters it needs the database and the model, so the work is done by CareersPageService,
// handed in through the context.
export const careersPage: Adapter<{ provider: 'careers_page'; url: string; note?: string }> = async ({ url }, ctx) => {
  if (!ctx.careersPage || !ctx.sourceId || !ctx.userId) {
    throw new PermanentSourceError('Careers pages need the page reader, which this worker was started without');
  }
  return ctx.careersPage.read({ sourceId: ctx.sourceId, userId: ctx.userId, name: ctx.sourceName, url });
};
