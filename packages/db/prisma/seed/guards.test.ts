import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAREER_DATA, type CareerData, type SeedEvidence } from './career-data.ts';
import { findSeedProblems } from './guards.ts';

test('the real career data passes every guard', () => {
  assert.deepEqual(findSeedProblems(CAREER_DATA), []);
});

const base = (): CareerData => ({
  workExperiences: [
    { key: 'job', company: 'Co', title: 'Dev', location: 'X', startDate: new Date('2024-01-01'), isCurrent: true },
  ],
  projects: [],
  skills: [],
});

const ev = (over: Partial<SeedEvidence> = {}): SeedEvidence => ({
  context: 'COMMERCIAL',
  depth: 'PRODUCTION',
  whatIDid: 'Did a thing',
  lastUsed: new Date('2025-01-01'),
  workExperience: 'job',
  ...over,
});

test('rejects any mention of Azure', () => {
  const data = base();
  data.skills.push({ name: 'Azure B2C', category: 'PLATFORM', evidence: [ev()] });
  data.skills.push({ name: 'Auth', category: 'CONCEPT', evidence: [ev({ whatIDid: 'Integrated azure b2c login' })] });
  assert.equal(findSeedProblems(data).filter((p) => /forbidden/i.test(p)).length, 2);
});

test('rejects Node.js / Express.js / MongoDB as commercial experience', () => {
  const data = base();
  for (const name of ['Node.js', 'Express.js', 'MongoDB']) {
    data.skills.push({ name, category: 'PLATFORM', evidence: [ev()] });
  }
  assert.equal(findSeedProblems(data).filter((p) => /not commercial/.test(p)).length, 3);
});

test('rejects evidence that carries verification', () => {
  const data = base();
  const verified = { ...ev(), isVerified: true } as SeedEvidence;
  data.skills.push({ name: 'React', category: 'LIBRARY', evidence: [verified] });
  assert.match(findSeedProblems(data).join('\n'), /never carry verification/);
});

test('rejects commercial evidence without a work experience, and dangling links', () => {
  const data = base();
  data.skills.push({ name: 'A', category: 'TOOL', evidence: [ev({ workExperience: undefined })] });
  data.skills.push({ name: 'B', category: 'TOOL', evidence: [ev({ workExperience: 'nope' })] });
  const problems = findSeedProblems(data).join('\n');
  assert.match(problems, /must link to a work experience/);
  assert.match(problems, /unknown work experience "nope"/);
});

test('rejects future lastUsed and duplicate skills', () => {
  const data = base();
  data.skills.push({ name: 'X', category: 'TOOL', evidence: [ev({ lastUsed: new Date('2999-01-01') })] });
  data.skills.push({ name: 'x', category: 'TOOL', evidence: [ev()] });
  const problems = findSeedProblems(data).join('\n');
  assert.match(problems, /in the future/);
  assert.match(problems, /Duplicate skill/);
});
