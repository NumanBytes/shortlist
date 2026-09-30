import { z } from 'zod';

// The rule filter's settings (Agents.md §5: "cheap rule filter, NO AI CALL").
// Matching is case-insensitive and whole-word: "react" matches "React.js developer"
// but not "reactive"; multi-word terms like "full stack" match as a phrase.
const terms = z.array(z.string().trim().min(1).max(60)).max(100);

export const DiscoveryPreferencesSchema = z
  .object({
    titleInclude: terms,
    titleExclude: terms,
    stackKeywords: terms,
    onsiteLocations: terms,
    allowRemote: z.boolean(),
    remoteExcludeRegions: terms,
    maxPostingAgeDays: z.number().int().min(1).max(365),
  })
  .strict();

export type DiscoveryPreferencesInput = z.infer<typeof DiscoveryPreferencesSchema>;

// Tuned for a ~2-year frontend/full-stack developer in Lahore (Agents.md §1, §6).
export const DEFAULT_DISCOVERY_PREFERENCES: DiscoveryPreferencesInput = {
  titleInclude: [
    'developer', 'engineer', 'software', 'frontend', 'front-end', 'front end',
    'full stack', 'full-stack', 'fullstack', 'react', 'mern', 'javascript', 'typescript', 'web',
  ],
  // Seniority well beyond ~2 years, and roles outside the stack. "Senior" is kept:
  // it's a stretch, and whether to apply is the match scorer's call, not the filter's.
  titleExclude: [
    'principal', 'staff', 'director', 'head of', 'vp', 'manager', 'architect', 'intern', 'internship',
    'ios', 'android', 'flutter', 'kotlin', 'swift', 'embedded', 'firmware',
    'data scientist', 'data engineer', 'data analyst', 'machine learning', 'ml engineer',
    'devops', 'sre', 'site reliability', 'qa', 'sqa', 'test', 'security',
    'salesforce', 'sap', 'sales', 'marketing', 'designer', 'recruiter', 'hr', 'support',
    // German-market postings (the "(m/w/d)" gender tag is a reliable sign of a
    // Germany-based role) and student jobs — mostly from Arbeitnow.
    'werkstudent', 'praktikum', 'm/w/d', 'w/m/d', 'm/f/d',
  ],
  stackKeywords: [
    'react', 'react.js', 'reactjs', 'next.js', 'nextjs', 'typescript', 'javascript',
    'node', 'node.js', 'nodejs', 'nestjs', 'express', 'mern', 'tailwind', 'angular',
  ],
  onsiteLocations: ['lahore', 'pakistan', 'pk'],
  allowRemote: true,
  // Remote roles open only to these regions can't hire from Pakistan.
  remoteExcludeRegions: [
    'us only', 'usa only', 'u.s. only', 'united states', 'usa', 'us-based', 'canada', 'north america',
    'americas', 'latam', 'latin america', 'brazil', 'mexico', 'uk only', 'united kingdom', 'europe only',
    'eu only', 'germany', 'australia', 'new zealand', 'india',
  ],
  maxPostingAgeDays: 30,
};
