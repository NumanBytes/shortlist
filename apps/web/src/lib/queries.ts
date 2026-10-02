import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateEducationInput,
  UpdateEducationInput,
  UpdateProfileInput,
  UpdateSkillEvidenceInput,
  PrepareResumeInput,
} from '@shortlist/shared';
import { api } from './api';
import type {
  AiUsage,
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

export const useUpdateEvidence = () =>
  useEvidenceMutation(({ id, body }: { id: string; body: UpdateSkillEvidenceInput }) =>
    api<Evidence>(`/evidence/${id}`, { method: 'PATCH', body }),
  );

// ── Jobs & discovery ─────────────────────────────────────────────────────────
export const jobKeys = {
  all: ['jobs'] as const,
  list: (status?: JobStatus, sort: JobSort = 'score') => ['jobs', 'list', status ?? 'all', sort] as const,
  detail: (id: string) => ['jobs', 'detail', id] as const,
  sources: ['discovery', 'sources'] as const,
  aiUsage: ['ai', 'usage'] as const,
};

export type JobSort = 'score' | 'recent';

export const useJobs = (status?: JobStatus, sort: JobSort = 'score') =>
  useQuery({
    queryKey: jobKeys.list(status, sort),
    queryFn: () => api<JobListItem[]>(`/jobs?sort=${sort}${status ? `&status=${status}` : ''}`),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobKeys.sources }),
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

// Polls while the worker is tailoring, then stops.
export const useJobResume = (jobId: string, enabled: boolean) =>
  useQuery({
    queryKey: resumeKeys.job(jobId),
    queryFn: () => api<JobResume>(`/jobs/${jobId}/resume`),
    enabled,
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? 3000 : false),
  });

export function usePrepareResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, body }: { jobId: string; body: PrepareResumeInput }) =>
      api<JobResume>(`/jobs/${jobId}/resume`, { method: 'POST', body }),
    onSuccess: (data, { jobId }) => {
      queryClient.setQueryData(resumeKeys.job(jobId), data);
      void queryClient.invalidateQueries({ queryKey: jobKeys.aiUsage });
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
