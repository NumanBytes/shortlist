import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateEducationInput,
  CreateProjectInput,
  CreateWorkExperienceInput,
  UpdateProjectInput,
  UpdateWorkExperienceInput,
  CreateSkillEvidenceInput,
  CreateSkillInput,
  UpdateEducationInput,
  UpdateProfileInput,
  UpdateSkillEvidenceInput,
  PrepareResumeInput,
} from '@shortlist/shared';
import { api } from './api';
import type {
  ActiveTailoring,
  AiUsage,
  DiscoveryStatus,
  DiscoverySource,
  Education,
  PublicUser,
  Evidence,
  JobDetail,
  JobListItem,
  JobStatus,
  Project,
  RunNowResult,
  Skill,
  WorkExperience,
  GmailStatus,
  JobResume,
} from './types';

export const keys = {
  skills: ['skills'] as const,
  workExperiences: ['work-experiences'] as const,
  projects: ['projects'] as const,
};

export const useSkills = () => useQuery({ queryKey: keys.skills, queryFn: () => api<Skill[]>('/skills') });

export const useWorkExperiences = () =>
  useQuery({ queryKey: keys.workExperiences, queryFn: () => api<WorkExperience[]>('/work-experiences') });

export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: () => api<Project[]>('/projects') });

// Replaces one evidence row inside the cached skills list.
function patchEvidence(skills: Skill[] | undefined, updated: Evidence): Skill[] | undefined {
  return skills?.map((s) =>
    s.id !== updated.skillId ? s : { ...s, evidence: s.evidence.map((e) => (e.id === updated.id ? updated : e)) },
  );
}

// Every evidence mutation returns the updated row, so the cache is patched with the
// server's answer rather than refetching the whole list. Verification is deliberately
// NOT optimistic: the UI only shows "verified" once the server has recorded it.
function useEvidenceMutation<V>(request: (vars: V) => Promise<Evidence>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (updated) => queryClient.setQueryData<Skill[]>(keys.skills, (s) => patchEvidence(s, updated)),
  });
}

export const useVerifyEvidence = () =>
  useEvidenceMutation((id: string) => api<Evidence>(`/evidence/${id}/verify`, { method: 'POST' }));

export const useUnverifyEvidence = () =>
  useEvidenceMutation((id: string) => api<Evidence>(`/evidence/${id}/unverify`, { method: 'POST' }));

// Adding a skill or evidence refetches the list: new items arrive unverified, and the
// server decides everything else about them.
export function useCreateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSkillInput) => api<Skill>('/skills', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.skills }),
  });
}

export function useCreateEvidence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSkillEvidenceInput) => api<Evidence>('/evidence', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.skills }),
  });
}

export const useUpdateEvidence = () =>
  useEvidenceMutation(({ id, body }: { id: string; body: UpdateSkillEvidenceInput }) =>
    api<Evidence>(`/evidence/${id}`, { method: 'PATCH', body }),
  );

// ── Jobs & discovery ─────────────────────────────────────────────────────────
export const jobKeys = {
  all: ['jobs'] as const,
  list: (status?: JobStatus, sort: JobSort = 'score', sourceId?: string) =>
    ['jobs', 'list', status ?? 'all', sort, sourceId ?? 'any'] as const,
  detail: (id: string) => ['jobs', 'detail', id] as const,
  sources: ['discovery', 'sources'] as const,
  discoveryStatus: ['discovery', 'status'] as const,
  aiUsage: ['ai', 'usage'] as const,
};

export type JobSort = 'score' | 'recent';

export const useJobs = (status?: JobStatus, sort: JobSort = 'score', sourceId?: string) =>
  useQuery({
    queryKey: jobKeys.list(status, sort, sourceId),
    queryFn: () => {
      const q = new URLSearchParams({ sort });
      if (status) q.set('status', status);
      if (sourceId) q.set('sourceId', sourceId);
      return api<JobListItem[]>(`/jobs?${q}`);
    },
  });

// Jobs per status, for the tab counts. Under jobKeys.all, so every status change refreshes it.
export const useJobCounts = (sourceId?: string) =>
  useQuery({
    queryKey: ['jobs', 'counts', sourceId ?? 'any'] as const,
    queryFn: () => api<Partial<Record<JobStatus, number>>>(`/jobs/counts${sourceId ? `?sourceId=${sourceId}` : ''}`),
  });

export function useAnalyzeJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/jobs/${id}/analyze`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.aiUsage });
    },
  });
}

export const useAiUsage = () => useQuery({ queryKey: jobKeys.aiUsage, queryFn: () => api<AiUsage>('/ai/usage') });

export function useUpdateAiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<AiUsage['settings']>) => api('/ai/settings', { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobKeys.aiUsage }),
  });
}

export const useJobDetail = (id: string, enabled: boolean) =>
  useQuery({ queryKey: jobKeys.detail(id), queryFn: () => api<JobDetail>(`/jobs/${id}`), enabled });

export function useSetJobStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) =>
      api<JobListItem>(`/jobs/${id}`, { method: 'PATCH', body: { status } }),
    // A status change moves the job between filtered lists; refetch them all.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobKeys.all }),
  });
}

export const useSources = () =>
  useQuery({ queryKey: jobKeys.sources, queryFn: () => api<DiscoverySource[]>('/discovery/sources') });

export function useRunDiscovery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<RunNowResult>('/discovery/run', { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.sources });
      void queryClient.invalidateQueries({ queryKey: jobKeys.discoveryStatus });
    },
  });
}

// `watch`: poll every 5s — just after "Find new jobs", before the worker has picked
// anything up. While a run is in progress it polls too. Otherwise a slow 60s refresh
// keeps "Last checked 2h ago" honest without hammering the API.
export const useDiscoveryStatus = (watch = false) =>
  useQuery({
    queryKey: jobKeys.discoveryStatus,
    queryFn: () => api<DiscoveryStatus>('/discovery/status'),
    refetchInterval: (q) => (watch || (q.state.data?.running ?? 0) > 0 ? 5000 : 60_000),
  });

// "Retry" on one failed or empty source (same cooldown as run-now; 409 says when).
export function useRunSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/discovery/sources/${id}/run`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.sources });
      void queryClient.invalidateQueries({ queryKey: jobKeys.discoveryStatus });
    },
  });
}

// "Edit URL": a new link (or name) for a company board that moved.
export function useSetSourceAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, address }: { id: string; address: string }) => api(`/discovery/sources/${id}/address`, { method: 'PATCH', body: { address } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.sources });
      void queryClient.invalidateQueries({ queryKey: jobKeys.discoveryStatus });
    },
  });
}

// "Cancel" a tailoring run that hasn't started (409 if the worker is already writing it).
export function useCancelTailoring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api<JobResume>(`/jobs/${jobId}/resume/cancel`, { method: 'POST' }),
    onSuccess: (data, jobId) => {
      queryClient.setQueryData(resumeKeys.job(jobId), data);
      void queryClient.invalidateQueries({ queryKey: resumesActiveKey });
    },
  });
}

export function useSetSourceEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      api(`/discovery/sources/${id}`, { method: 'PATCH', body: { isEnabled } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobKeys.sources }),
  });
}

// ── Roles and projects (career truth, Agents.md §6) ───────────────────────────
// A change to what a role or project claims un-verifies its linked evidence on the
// server, so the skills list is refetched too.
function useCareerMutation<V>(request: (vars: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.workExperiences });
      void queryClient.invalidateQueries({ queryKey: keys.projects });
      void queryClient.invalidateQueries({ queryKey: keys.skills });
    },
  });
}

export const useSaveRole = () =>
  useCareerMutation(({ id, body }: { id?: string; body: CreateWorkExperienceInput | UpdateWorkExperienceInput }) =>
    id ? api(`/work-experiences/${id}`, { method: 'PATCH', body }) : api('/work-experiences', { method: 'POST', body }),
  );
export const useDeleteRole = () => useCareerMutation((id: string) => api(`/work-experiences/${id}`, { method: 'DELETE' }));
export const useSaveProject = () =>
  useCareerMutation(({ id, body }: { id?: string; body: CreateProjectInput | UpdateProjectInput }) =>
    id ? api(`/projects/${id}`, { method: 'PATCH', body }) : api('/projects', { method: 'POST', body }),
  );
export const useDeleteProject = () => useCareerMutation((id: string) => api(`/projects/${id}`, { method: 'DELETE' }));

// ── Profile & education (the resume header) ─────────────────────────────────
export const profileKeys = { profile: ['profile'] as const, education: ['education'] as const };

export const useProfile = () => useQuery({ queryKey: profileKeys.profile, queryFn: () => api<PublicUser>('/profile') });

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileInput) => api<PublicUser>('/profile', { method: 'PATCH', body }),
    onSuccess: (user) => queryClient.setQueryData(profileKeys.profile, user),
  });
}

export const useEducation = () => useQuery({ queryKey: profileKeys.education, queryFn: () => api<Education[]>('/education') });

export function useSaveEducation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: CreateEducationInput | UpdateEducationInput }) =>
      id ? api<Education>(`/education/${id}`, { method: 'PATCH', body }) : api<Education>('/education', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileKeys.education }),
  });
}

export function useDeleteEducation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/education/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileKeys.education }),
  });
}

// ── Resumes ──────────────────────────────────────────────────────────────────
export const resumeKeys = { job: (jobId: string) => ['jobs', 'resume', jobId] as const };

// While the worker is tailoring, poll — but not forever (Agents.md §13.1). A real run takes
// well under two minutes, so: every 3s at first, every 10s after a minute, every 15s
// while no worker is running (to notice it starting), and not at all once it has waited
// TAILOR_POLL_LIMIT_MS — the card then says so and offers "Check again".
export const TAILOR_POLL_LIMIT_MS = 15 * 60 * 1000;

export function tailorPollInterval(resume: JobResume | undefined, now = Date.now()): number | false {
  if (resume?.status !== 'PENDING') return false;
  const waited = resume.queuedAt ? now - new Date(resume.queuedAt).getTime() : 0;
  if (waited > TAILOR_POLL_LIMIT_MS) return false;
  if (resume.workerOnline === false) return 15_000;
  return waited < 60_000 ? 3000 : 10_000;
}

export const useJobResume = (jobId: string, enabled: boolean) =>
  useQuery({
    queryKey: resumeKeys.job(jobId),
    queryFn: () => api<JobResume>(`/jobs/${jobId}/resume`),
    enabled,
    refetchInterval: (q) => tailorPollInterval(q.state.data),
  });

// Resumes being tailored anywhere — the app-wide "Tailoring…" pill. Polled only while
// there are some; starting one refreshes it (usePrepareResume).
export const resumesActiveKey = ['resumes', 'active'] as const;
export const useActiveTailoring = () =>
  useQuery({
    queryKey: resumesActiveKey,
    queryFn: () => api<ActiveTailoring[]>('/resumes/active'),
    refetchInterval: (q) => (q.state.data?.length ? 10_000 : false),
  });

export function usePrepareResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, body }: { jobId: string; body: PrepareResumeInput }) =>
      api<JobResume>(`/jobs/${jobId}/resume`, { method: 'POST', body }),
    onSuccess: (data, { jobId }) => {
      queryClient.setQueryData(resumeKeys.job(jobId), data);
      void queryClient.invalidateQueries({ queryKey: jobKeys.aiUsage });
      void queryClient.invalidateQueries({ queryKey: resumesActiveKey });
    },
  });
}

// Never optimistic: "Approved" shows only after the server confirms.
export function useApproveResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ variantId }: { variantId: string; jobId: string }) => api(`/resumes/${variantId}/approve`, { method: 'POST' }),
    onSuccess: (_, { jobId }) => queryClient.invalidateQueries({ queryKey: resumeKeys.job(jobId) }),
  });
}

// ── Gmail job alerts ─────────────────────────────────────────────────────────
export const gmailKeys = { status: ['gmail'] as const };

// Polls every 4s until the query has fetched `pollUntilCount` times — set after "Check now"
// or connecting, so the check's result appears by itself and polling then stops.
export const useGmail = (pollUntilCount = 0) =>
  useQuery({
    queryKey: gmailKeys.status,
    queryFn: () => api<GmailStatus>('/gmail'),
    refetchInterval: (q) => (q.state.dataUpdateCount < pollUntilCount ? 4000 : false),
  });

// Returns Google's consent URL; the caller navigates there (a full-page redirect, not a popup).
export const useConnectGmail = () => useMutation({ mutationFn: () => api<{ url: string }>('/gmail/connect', { method: 'POST' }) });

export function useCheckGmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('/gmail/check', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gmailKeys.status }),
  });
}

export function useDisconnectGmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('/gmail', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gmailKeys.status }),
  });
}

// "Paste full description" (Agents.md §10.5): completes an alert-only job; it's scored again.
export function usePasteDescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, description }: { id: string; description: string }) =>
      api<JobDetail>(`/jobs/${id}/description`, { method: 'POST', body: { description } }),
    onSuccess: (job) => {
      queryClient.setQueryData(jobKeys.detail(job.id), job);
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
}
