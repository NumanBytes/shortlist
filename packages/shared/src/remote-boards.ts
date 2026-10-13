import type { JobSourceConfig } from './job-source.schema.js';

// The remote-job aggregators every user can follow — not tied to anyone's city or company
// list. Onboarding adds them in one tap (docs/discovery.md §9.13); the seed uses the same list.
// Their terms require attribution and a link back (docs/discovery.md §9.10).
export const REMOTE_BOARDS: { key: string; name: string; config: JobSourceConfig }[] = [
  { key: 'remoteok', name: 'Remote OK', config: { provider: 'remoteok' } },
  { key: 'remotive:software-dev', name: 'Remotive', config: { provider: 'remotive', category: 'software-dev' } },
  { key: 'arbeitnow', name: 'Arbeitnow', config: { provider: 'arbeitnow', maxPages: 3 } },
  { key: 'himalayas', name: 'Himalayas', config: { provider: 'himalayas', maxPages: 5 } },
  { key: 'jobicy', name: 'Jobicy', config: { provider: 'jobicy' } },
  {
    key: 'weworkremotely:full-stack',
    name: 'We Work Remotely — Full-Stack',
    config: { provider: 'weworkremotely', category: 'remote-full-stack-programming-jobs' },
  },
  {
    key: 'weworkremotely:front-end',
    name: 'We Work Remotely — Front-End',
    config: { provider: 'weworkremotely', category: 'remote-front-end-programming-jobs' },
  },
];
