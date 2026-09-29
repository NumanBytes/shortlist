import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateSkillEvidenceInput } from '@shortlist/shared';
import { api } from './api';
import type { Evidence, Project, Skill, WorkExperience } from './types';

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
