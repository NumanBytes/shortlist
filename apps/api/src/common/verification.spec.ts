import { claimChanged } from './verification.js';

describe('claimChanged', () => {
  const existing = { company: 'CloudCard', startDate: new Date('2024-05-01'), location: 'Lahore' };
  const fields = ['company', 'startDate'] as const;

  it('is false when a claim field is resent with the same value (incl. a fresh Date)', () => {
    expect(claimChanged(fields, { company: 'CloudCard', startDate: new Date('2024-05-01') }, existing)).toBe(false);
  });

  it('is true when a claim field changes', () => {
    expect(claimChanged(fields, { company: 'Google' }, existing)).toBe(true);
    expect(claimChanged(fields, { startDate: new Date('2023-01-01') }, existing)).toBe(true);
  });

  it('ignores changes to non-claim fields', () => {
    expect(claimChanged(fields, { location: 'Karachi' }, existing)).toBe(false);
  });
});
