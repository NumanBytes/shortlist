import type { JobListItem } from '../lib/types';

export const job: JobListItem = {
  id: 'j1',
  title: 'Full Stack Software Engineer (MERN)',
  company: 'Septem Systems',
  location: 'Lahore, Punjab, pk',
  workMode: 'ONSITE',
  source: 'smartrecruiters',
  sourceUrl: 'https://jobs.smartrecruiters.com/SeptemSystems/744000094846166',
  status: 'DISCOVERED',
  postedAt: '2025-11-21T13:29:11.629Z',
  discoveredAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  appliedAt: null,
  jobSource: { id: 's1', name: 'Septem Systems' },
  analysisStatus: 'DONE',
  analysisError: null,
  redFlags: [],
  match: { overallScore: 86, commercialScore: 80, verdict: 'APPLY' },
};
