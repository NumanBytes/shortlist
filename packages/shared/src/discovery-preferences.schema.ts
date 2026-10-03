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
    // Jobs with no description (alert emails, Agents.md §10.5) can't be checked for the
    // stack, so they pass if the title or summary names a stack keyword OR the title names
    // one of these software roles. Keeps "Full Stack Engineer"; drops "Electrical Engineer".
    roleTitleTerms: terms,
    onsiteLocations: terms,
    allowRemote: z.boolean(),
    remoteAllowRegions: terms,
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
  roleTitleTerms: [
    'software', 'full stack', 'full-stack', 'fullstack', 'frontend', 'front-end', 'front end',
    'web developer', 'web engineer', 'web application', 'ui developer', 'ui engineer',
  ],
  onsiteLocations: ['lahore', 'pakistan', 'pk'],
  allowRemote: true,
  // A remote role passes only if its location is empty, names a worldwide term, or names
  // only regions in this list. An allow-list, not a block-list: the first real run let
  // through roles limited to Poland, Argentina, France, South Africa, Nepal… — a block-
  // list can never name every country that can't hire from Pakistan (decided 2026-10-02).
  remoteAllowRegions: [
    'worldwide', 'anywhere', 'anywhere in the world', 'global', 'globally', 'international',
    'remote', 'asia', 'apac', 'asia pacific', 'south asia', 'pakistan', 'lahore', 'pk',
  ],
  maxPostingAgeDays: 30,
};
