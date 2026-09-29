import type { CareerData } from './career-data.ts';

// Claims that are known to be false (Agents.md §6). If the seed data ever contains
// one, refuse to write anything.
const FORBIDDEN_TEXT = [/azure/i];
const NEVER_COMMERCIAL = new Set(['node.js', 'express.js', 'mongodb']);

// Returns every problem found; an empty array means the data is safe to seed.
export function findSeedProblems(data: CareerData): string[] {
  const problems: string[] = [];
  const workKeys = new Set(data.workExperiences.map((w) => w.key));
  const projectKeys = new Set(data.projects.map((p) => p.key));
  const seenSkills = new Set<string>();

  for (const skill of data.skills) {
    const lower = skill.name.toLowerCase();
    if (seenSkills.has(lower)) problems.push(`Duplicate skill: ${skill.name}`);
    seenSkills.add(lower);

    for (const re of FORBIDDEN_TEXT) {
      if (re.test(skill.name)) problems.push(`Forbidden claim in skill name: ${skill.name}`);
    }

    const seenPairs = new Set<string>();
    for (const ev of skill.evidence) {
      const where = `${skill.name} (${ev.context}/${ev.depth})`;
      const pair = `${ev.context}/${ev.depth}`;
      if (seenPairs.has(pair)) problems.push(`${where}: duplicate context/depth on one skill`);
      seenPairs.add(pair);

      if ('isVerified' in ev || 'verifiedAt' in ev) {
        problems.push(`${where}: seed data must never carry verification`);
      }
      for (const re of FORBIDDEN_TEXT) {
        if (re.test(ev.whatIDid)) problems.push(`${where}: forbidden claim in whatIDid`);
      }
      if (ev.context === 'COMMERCIAL' && NEVER_COMMERCIAL.has(lower)) {
        problems.push(`${where}: ${skill.name} is not commercial experience`);
      }
      if (ev.context === 'COMMERCIAL' && !ev.workExperience) {
        problems.push(`${where}: commercial evidence must link to a work experience`);
      }
      if (ev.workExperience && ev.project) problems.push(`${where}: links both a role and a project`);
      if (ev.workExperience && !workKeys.has(ev.workExperience)) {
        problems.push(`${where}: unknown work experience "${ev.workExperience}"`);
      }
      if (ev.project && !projectKeys.has(ev.project)) problems.push(`${where}: unknown project "${ev.project}"`);
      if (ev.lastUsed.getTime() > Date.now()) problems.push(`${where}: lastUsed is in the future`);
      if (!ev.whatIDid.trim()) problems.push(`${where}: empty whatIDid`);
    }
  }
  return problems;
}
