import type { ImplementedSourceConfig, SourceProvider } from '@shortlist/shared';

export type WorkMode = 'REMOTE' | 'HYBRID' | 'ONSITE';

// One job posting, normalized from any source.
export interface Posting {
  externalId: string; // the source's own id — stable across runs
  title: string;
  company: string;
  location: string | null; // free text as the source gave it
  workMode: WorkMode | null; // null = the source didn't say
  url: string; // the original posting; "Apply" always goes here (attribution terms)
  postedAt: Date | null;
  salary?: string | null; // as the source wrote it, when it gives one
  // Some sources include the description in their list response. Others need one
  // request per posting — those provide loadDescription, which the pipeline only calls
  // for postings that already passed the cheap title/location/age screen.
  description: string | null;
  loadDescription?: () => Promise<string>;
}

export interface AdapterContext {
  sourceName: string; // JobSource.name — used as the company for single-company boards
}

export type Adapter<C> = (config: C, ctx: AdapterContext) => Promise<Posting[]>;

// Exactly one adapter per implemented provider, each typed to its own config shape.
export type AdapterRegistry = {
  [P in SourceProvider]: Adapter<Extract<ImplementedSourceConfig, { provider: P }>>;
};
