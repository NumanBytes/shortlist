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
  phone: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  createdAt: string;
}

export interface Education {
  id: string;
  degree: string;
  institution: string;
  location: string | null;
  startYear: number | null;
  endYear: number | null;
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
  startDate: string;
  endDate: string | null;
  isCurrent: boolean;
  location: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  workExperienceId: string | null;
  liveUrl: string | null;
  repoUrl: string | null;
  isShipped: boolean;
  startDate: string | null;
  endDate: string | null;
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
  jobSource: { id: string; name: string; type: 'ATS_BOARD' | 'AGGREGATOR_API' | 'EMAIL_INBOX' | 'MANUAL' } | null;
  analysisStatus: AnalysisStatus;
  analysisError: string | null;
  redFlags: string[];
  isPartial: boolean; // from an alert email: only a summary until the description is pasted
  salary: string | null;
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
  settings: { maxAnalysesPerDay: number; monthlyBudgetUsd: number; resumeReuseMinOverlap: number };
  monthToDateUsd: number;
  callsThisMonth: number;
  analysesLast24h: number;
  last24hUsd: number; // every AI call in the last 24h — the "Today" tile
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
  board: string | null; // a company board's name, editable via "Edit URL"; null for aggregators
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
  emailQueued: boolean;
}

// How fresh the job list is, and what "Find new jobs" can do right now.
export interface DiscoveryStatus {
  enabledSources: number;
  lastCheckedAt: string | null;
  running: number;
  availableAt: string | null; // null: a manual run would queue something now
  nextNightlyAt: string | null;
  workerOnline: boolean | null; // null: Redis didn't answer
  cooldownHours: number;
  jobsThisWeek: number;
}

// A resume the worker is tailoring (or waiting to) — shown on every page.
export interface ActiveTailoring {
  jobId: string;
  title: string;
  company: string;
  queuedAt: string;
}

// ── Resumes (Agents.md §13) ──────────────────────────────────────────────────
export interface ResumeBullet {
  label: string | null;
  text: string;
  evidenceIds: string[];
}

export interface ResumeContent {
  experience: {
    workExperienceId: string;
    title: string;
    company: string;
    location: string | null;
    startDate: string;
    endDate: string | null;
    isCurrent: boolean;
    bullets: ResumeBullet[];
  }[];
  projects: { projectId: string; name: string; bullets: ResumeBullet[] }[];
  skillGroups: { label: string; skills: { id: string; name: string }[] }[];
  dropped: { where: string; text: string; reason: string }[];
}

export interface JobResume {
  status: 'NONE' | 'PENDING' | 'READY' | 'DEFERRED' | 'FAILED';
  error: string | null;
  queuedAt: string | null; // while PENDING
  workerOnline: boolean | null; // while PENDING; null when unknown
  reused: boolean;
  overlap: number | null;
  canTailor: boolean;
  needsDescription: boolean; // alert-only job: paste the full description before tailoring
  variant: {
    id: string;
    status: 'DRAFT' | 'APPROVED';
    model: string;
    generatedAt: string;
    approvedAt: string | null;
    stale: string[];
    content: ResumeContent;
  } | null;
  sources: Record<string, { skillName: string; whatIDid: string; isVerified: boolean; context: EvidenceContext; depth: EvidenceDepth; lastUsed: string }>;
  reuse: { variantId: string; overlap: number; approvedAt: string | null; usedFor: string[] }[];
}

// ── Gmail job alerts (Agents.md §10) ─────────────────────────────────────────
export interface GmailStatus {
  configured: boolean;
  connection: {
    emailAddress: string;
    labelName: string;
    status: 'ACTIVE' | 'NEEDS_RECONNECT';
    lastError: string | null;
    connectedAt: string;
    lastCheckedAt: string | null;
    lastCheckStatus: RunStatus | null;
    lastCheckFound: number | null;
  } | null;
  last30Days: {
    alerts: number;
    notAlerts: number;
    deferred: number;
    failed: number;
    portals: {
      portal: string;
      sourceId: string | null; // its JobSource, for the "View jobs" link
      label: string;
      emails: number;
      jobsFound: number;
      parserWarnings: number;
      lastRun: { status: RunStatus; jobsNew: number; finishedAt: string | null } | null;
    }[];
  };
}
