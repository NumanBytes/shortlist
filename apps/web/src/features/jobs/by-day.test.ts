import { groupByDay } from './by-day';
import { job } from '../../test/fixtures';
import type { JobListItem } from '../../lib/types';

const at = (id: string, discoveredAt: string, score: number | null): JobListItem => ({
  ...job,
  id,
  discoveredAt,
  match: score === null ? null : { overallScore: score, commercialScore: score, verdict: 'APPLY' },
});

describe('groupByDay', () => {
  const now = new Date(2026, 9, 13, 12, 0); // local 13 Oct, noon

  it('puts the newest day first and the best match first within a day', () => {
    const groups = groupByDay(
      [
        at('old-strong', new Date(2026, 9, 12, 2, 5).toISOString(), 95),
        at('new-weak', new Date(2026, 9, 13, 2, 5).toISOString(), 40),
        at('new-unscored', new Date(2026, 9, 13, 9, 0).toISOString(), null),
        at('new-strong', new Date(2026, 9, 13, 2, 1).toISOString(), 80),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday']);
    expect(groups[0]!.jobs.map((j) => j.id)).toEqual(['new-strong', 'new-weak', 'new-unscored']);
    expect(groups[1]!.jobs.map((j) => j.id)).toEqual(['old-strong']);
  });

  it('labels older days by date, with the weekday inside the last week', () => {
    const groups = groupByDay(
      [at('a', new Date(2026, 9, 9, 3).toISOString(), 50), at('b', new Date(2026, 8, 28, 3).toISOString(), 50)],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(['Fri 9 Oct', '28 Sept']);
  });
});
