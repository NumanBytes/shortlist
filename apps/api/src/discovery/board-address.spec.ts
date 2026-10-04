import { parseBoardAddress } from '@shortlist/shared';

// "Edit URL" on a failing board: paste the link or the name, keep only the board's name.
describe('parseBoardAddress', () => {
  it.each([
    ['greenhouse', 'https://boards.greenhouse.io/motive', { provider: 'greenhouse', board: 'motive' }],
    ['greenhouse', 'job-boards.greenhouse.io/motive/jobs/123', { provider: 'greenhouse', board: 'motive' }],
    ['greenhouse', 'https://boards-api.greenhouse.io/v1/boards/motive/jobs', { provider: 'greenhouse', board: 'motive' }],
    ['greenhouse', 'motive', { provider: 'greenhouse', board: 'motive' }],
    ['lever', 'https://jobs.lever.co/kwanso?team=Eng', { provider: 'lever', site: 'kwanso' }],
    ['smartrecruiters', 'https://careers.smartrecruiters.com/SeptemSystems', { provider: 'smartrecruiters', company: 'SeptemSystems' }],
    ['workable', 'https://apply.workable.com/programmers-force/', { provider: 'workable', account: 'programmers-force' }],
  ] as const)('%s: %s', (provider, input, config) => {
    expect(parseBoardAddress(provider, input)).toEqual({ ok: true, config });
  });

  it('refuses a link to a different platform, and junk', () => {
    expect(parseBoardAddress('greenhouse', 'https://jobs.lever.co/kwanso')).toEqual({ ok: false, error: "That isn't a greenhouse board link" });
    expect(parseBoardAddress('lever', 'not a board!')).toMatchObject({ ok: false });
    expect(parseBoardAddress('lever', 'https://jobs.lever.co/')).toMatchObject({ ok: false });
  });
});
