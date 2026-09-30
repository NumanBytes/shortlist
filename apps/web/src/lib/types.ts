// Response shapes from the API, as they arrive over JSON (dates are ISO strings).
// Request bodies are NOT defined here — they come from the Zod schemas in
// @shortlist/shared, the same ones the API validates against.
import type { EvidenceContext, EvidenceDepth } from '@shortlist/shared';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  headline: string | null;
  targetRole: string | null;
  location: string | null;
  createdAt: string;
}

export interface AuthResponse {
  user: PublicUser;
  accessToken: string;
}

export type SkillCategory = 'LANGUAGE' | 'FRAMEWORK' | 'LIBRARY' | 'DATABASE' | 'TOOL' | 'PLATFORM' | 'CONCEPT';

export interface Evidence {
  id: string;
  skillId: string;
  context: EvidenceContext;
  depth: EvidenceDepth;
  whatIDid: string;
  lastUsed: string;
  workExperienceId: string | null;
  projectId: string | null;
  isVerified: boolean;
  verifiedAt: string | null;
}

export interface Skill {
  id: string;
  name: string;
  category: SkillCategory;
  evidence: Evidence[];
}

export interface WorkExperience {
  id: string;
  company: string;
  title: string;
}

export interface Project {
  id: string;
  name: string;
}
