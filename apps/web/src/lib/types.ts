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

export type JobStatus =
  | 'DISCOVERED'
  | 'INTERESTED'
  | 'SKIPPED'
  | 'APPLIED'
  | 'ASSESSMENT'
  | 'INTERVIEWING'
  | 'REJECTED'
  | 'OFFER'
  | 'WITHDRAWN';

export interface JobListItem {
  id: string;
  title: string;
  company: string;
  location: string | null;
  workMode: 'REMOTE' | 'HYBRID' | 'ONSITE' | null;
  source: string | null;
  sourceUrl: string | null;
  status: JobStatus;
  postedAt: string | null;
  discoveredAt: string;
  lastSeenAt: string;
  appliedAt: string | null;
  jobSource: { id: string; name: string } | null;
  analysisStatus: AnalysisStatus;
  analysisError: string | null;
  redFlags: string[];
  match: { overallScore: number; commercialScore: number; verdict: Verdict } | null;
}

export type AnalysisStatus = 'PENDING' | 'DONE' | 'DEFERRED' | 'FAILED';
export type Verdict = 'APPLY' | 'STRETCH' | 'SKIP';
export type GapSeverity = 'BLOCKING' | 'MODERATE' | 'MINOR';

export interface JobDetail extends Omit<JobListItem, 'match'> {
  rawJD: string;
  seniority: string | null;
  yearsRequired: number | null;
  analyzedAt: string | null;
  requirements: {
    skillName: string;
    importance: 'REQUIRED' | 'PREFERRED' | 'BONUS';
    isCore: boolean;
    yearsRequired: number | null;
    matchedSkillIds: string[];
    relatedSkillIds: string[];
  }[];
  match: {
    overallScore: number;
    commercialScore: number;
    verdict: Verdict;
    strengths: string[];
    risks: string[];
    computedAt: string;
    gaps: { skillName: string; severity: GapSeverity; note: string | null }[];
  } | null;
}

export interface AiUsage {
  settings: { maxAnalysesPerDay: number; monthlyBudgetUsd: number };
  monthToDateUsd: number;
  callsThisMonth: number;
  analysesLast24h: number;
  jobs: { pending: number; done: number; deferred: number; failed: number };
}

export type RunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'EMPTY';

export interface DiscoverySource {
  id: string;
  key: string;
  name: string;
  type: 'ATS_BOARD' | 'AGGREGATOR_API' | 'EMAIL_INBOX' | 'MANUAL';
  provider: string;
  supported: boolean;
  isEnabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
  jobCount: number;
  lastRun: {
    status: RunStatus;
    startedAt: string;
    finishedAt: string | null;
    jobsFound: number;
    jobsMatched: number;
    jobsNew: number;
    errorMessage: string | null;
  } | null;
}

export interface RunNowResult {
  queued: string[];
  skipped: string[];
  cooldownHours: number;
}
