import { TAILOR_POLL_LIMIT_MS, tailorPollInterval } from './queries';
import type { JobResume } from './types';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const pending = (waitedMs: number, workerOnline: boolean | null = true) =>
  ({ status: 'PENDING', queuedAt: new Date(NOW - waitedMs).toISOString(), workerOnline }) as JobResume;

describe('tailorPollInterval — polls a tailoring run, but never forever', () => {
  it('does not poll unless a resume is being tailored', () => {
    expect(tailorPollInterval(undefined, NOW)).toBe(false);
    expect(tailorPollInterval({ status: 'READY' } as JobResume, NOW)).toBe(false);
  });

  it('polls quickly at first, then backs off', () => {
    expect(tailorPollInterval(pending(10_000), NOW)).toBe(3000);
    expect(tailorPollInterval(pending(5 * 60_000), NOW)).toBe(10_000);
  });

  it('polls slowly while no worker is running, to notice it starting', () => {
    expect(tailorPollInterval(pending(10_000, false), NOW)).toBe(15_000);
  });

  it('stops once it has waited far longer than a run takes', () => {
    expect(tailorPollInterval(pending(TAILOR_POLL_LIMIT_MS + 1), NOW)).toBe(false);
    expect(tailorPollInterval(pending(TAILOR_POLL_LIMIT_MS + 1, false), NOW)).toBe(false);
  });
});
