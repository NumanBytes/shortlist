import { z } from 'zod';
import { NON_EMPTY_UPDATE_MESSAGE, nonEmptyUpdate } from './common.schema.js';
import { AddSourceSchema } from './source-link.js';

// The shared source catalog (docs/discovery.md §9.16): an admin curates it, every user can
// follow from it.

// Where a source hires, as places people type in their search settings: lowercased,
// trimmed, no duplicates. "remote" marks the remote-job boards.
export const Regions = z
  .array(z.string().trim().toLowerCase().min(1).max(40))
  .max(10)
  .transform((r) => [...new Set(r)]);

// Admin: a company's jobs page or board becomes an entry, through the same link parsing
// as a user's "Add a source".
export const AddCatalogEntrySchema = AddSourceSchema.extend({ regions: Regions }).strict();
export type AddCatalogEntryInput = z.infer<typeof AddCatalogEntrySchema>;

// Admin: fix an entry. A new address or name reaches every follower still linked to it.
export const UpdateCatalogEntrySchema = z
  .object({
    name: z.string().trim().min(1, 'Give the company a name').max(100),
    address: z.string().trim().min(1, 'Paste the jobs page link').max(500),
    regions: Regions,
    isListed: z.boolean(),
  })
  .partial()
  .strict()
  .refine(nonEmptyUpdate, { message: NON_EMPTY_UPDATE_MESSAGE });
export type UpdateCatalogEntryInput = z.infer<typeof UpdateCatalogEntrySchema>;

// Browsing: a name search and/or one place. Query strings, so everything is optional text.
export const CatalogQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    region: z.string().trim().toLowerCase().max(40).optional(),
  })
  .strict();
export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;

// Onboarding: follow every listed entry in these places in one tap.
export const FollowPlacesSchema = z.object({ regions: Regions.pipe(z.array(z.string()).min(1)) }).strict();
export type FollowPlacesInput = z.infer<typeof FollowPlacesSchema>;

// Does an entry hire in one of these places? A user's "lahore, pakistan" matches an entry
// tagged "lahore"; matching is on whole words, so "pk" doesn't match "pakistan".
export function regionMatches(entryRegions: readonly string[], places: readonly string[]): boolean {
  const wanted = new Set(
    places.flatMap((p) =>
      p
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(Boolean),
    ),
  );
  return entryRegions.some((r) => wanted.has(r) || r.split(/\s+/).every((w) => wanted.has(w)));
}
