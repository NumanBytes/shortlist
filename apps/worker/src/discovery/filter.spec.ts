import { DEFAULT_DISCOVERY_PREFERENCES } from '@shortlist/shared';
import { compileFilter, termMatcher } from './filter.js';
import type { Posting } from './types.js';

const NOW = new Date('2026-10-01T00:00:00Z');
const posting = (over: Partial<Posting> = {}): Posting => ({
  externalId: '1',
  title: 'Frontend Engineer',
  company: 'Acme',
  location: 'Lahore, Pakistan',
  workMode: 'ONSITE',
  url: 'https://example.com/1',
  postedAt: new Date('2026-09-25T00:00:00Z'),
  description: null,
  ...over,
});

const filter = compileFilter(DEFAULT_DISCOVERY_PREFERENCES);
const screen = (over: Partial<Posting>, enforceMaxAge = true) => filter.screenListing(posting(over), { enforceMaxAge, now: NOW });

describe('termMatcher', () => {
  const m = termMatcher(['react', 'next.js', 'c++', 'full stack']);
  it('matches whole words case-insensitively, including dotted/symbol terms', () => {
    expect(m('Senior React.js developer')).toBe('react');
    expect(m('Built with Next.js')).toBe('next.js');
    expect(m('C++ required')).toBe('c++');
    expect(m('Full Stack Engineer')).toBe('full stack');
  });
  it('does not match inside other words', () => {
    expect(m('reactive systems')).toBeUndefined();
    expect(m('nextjsx')).toBeUndefined();
  });
});

describe('stage A — listing screen', () => {
  it('passes a relevant on-site role in Lahore', () => {
    expect(screen({})).toEqual({ pass: true });
  });

  it('rejects titles outside the target roles, with the reason', () => {
    expect(screen({ title: 'HR Executive' })).toEqual({ pass: false, reason: 'title: not a role we target' });
    expect(screen({ title: 'Senior iOS Engineer' })).toEqual({ pass: false, reason: 'title: excluded term "ios"' });
    expect(screen({ title: 'Principal Software Engineer' })).toMatchObject({ pass: false });
  });

  it('keeps "Senior" roles — whether to stretch is the scorer\'s call', () => {
    expect(screen({ title: 'Senior Frontend Engineer' })).toEqual({ pass: true });
  });

  it('rejects on-site roles outside Pakistan', () => {
    expect(screen({ location: 'Dubai, UAE' })).toMatchObject({ pass: false, reason: expect.stringContaining('location') });
  });

  it('accepts remote roles open worldwide, rejects region-locked ones', () => {
    expect(screen({ workMode: 'REMOTE', location: 'Worldwide' })).toEqual({ pass: true });
    expect(screen({ workMode: 'REMOTE', location: 'Anywhere in the World' })).toEqual({ pass: true });
    expect(screen({ workMode: 'REMOTE', location: 'Remote' })).toEqual({ pass: true });
    expect(screen({ workMode: 'REMOTE', location: 'APAC' })).toEqual({ pass: true });
    expect(screen({ workMode: 'REMOTE', location: 'USA' })).toEqual({ pass: false, reason: 'remote, but limited to "usa"' });
    expect(screen({ workMode: null, location: 'Remote - LATAM' })).toEqual({ pass: false, reason: 'remote, but limited to "latam"' });
  });

  it('rejects remote roles limited to countries that came through the old block-list (first real run)', () => {
    for (const location of ['Poland', 'Argentina', 'France, Netherlands', 'South Africa', 'Nepal', 'Leipzig', 'Homeoffice']) {
      expect(screen({ workMode: 'REMOTE', location })).toMatchObject({ pass: false });
    }
  });

  it('keeps a remote role with no stated location', () => {
    expect(screen({ workMode: 'REMOTE', location: null })).toEqual({ pass: true });
  });

  it('lets an allowed place win over a restricted-region mention', () => {
    expect(screen({ workMode: 'REMOTE', location: 'USA, Pakistan' })).toEqual({ pass: true });
  });

  it('gives unknown location + unknown work mode the benefit of the doubt', () => {
    expect(screen({ location: null, workMode: null })).toEqual({ pass: true });
  });

  it('on aggregators, drops postings older than the limit and keeps undated ones', () => {
    expect(screen({ postedAt: new Date('2026-08-01T00:00:00Z') })).toEqual({ pass: false, reason: 'older than 30 days' });
    expect(screen({ postedAt: null })).toEqual({ pass: true });
  });

  it('on company boards, ignores age — a listed job is an open job', () => {
    expect(screen({ postedAt: new Date('2025-11-21T00:00:00Z') }, false)).toEqual({ pass: true });
  });

  it('respects allowRemote = false', () => {
    const noRemote = compileFilter({ ...DEFAULT_DISCOVERY_PREFERENCES, allowRemote: false });
    expect(noRemote.screenListing(posting({ workMode: 'REMOTE', location: 'Worldwide' }), { enforceMaxAge: true, now: NOW })).toMatchObject({ pass: false });
  });
});

describe('stage B — description screen', () => {
  it('passes when the description mentions the core stack', () => {
    expect(filter.screenDescription(posting(), 'You will build features in React and TypeScript.')).toEqual({ pass: true });
  });

  it('counts a stack keyword in the title', () => {
    expect(filter.screenDescription(posting({ title: 'React Developer' }), 'Great team.')).toEqual({ pass: true });
  });

  it('rejects when neither mentions it', () => {
    expect(filter.screenDescription(posting(), 'Maintain our Java/Spring services.')).toMatchObject({ pass: false });
  });
});

describe('defaults, tuned from the first live run', () => {
  it('drops German-market and student postings', () => {
    expect(screen({ title: 'Werkstudent Full-Stack Entwicklung (m/w/d)' })).toMatchObject({ pass: false });
    expect(screen({ title: 'Full Stack Developer (m/w/d)', workMode: 'REMOTE', location: 'Remote' })).toMatchObject({ pass: false });
  });

  it('drops remote roles limited to India', () => {
    expect(screen({ workMode: 'REMOTE', location: 'India - Remote' })).toEqual({ pass: false, reason: 'remote, but limited to "india"' });
  });
});
