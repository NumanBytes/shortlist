// The builder's career database, drafted from Agents.md §6.
//
// Everything here is seeded UNVERIFIED. It is a draft of claims, not a set of facts:
// each item must be reviewed — and reworded if needed — by the user, then verified
// through POST /evidence/:id/verify before it can reach a resume. `whatIDid` wording
// stays deliberately close to §6 and adds nothing §6 doesn't say.
//
// Dates known only to the year use July 1 of that year.
import type { EvidenceContext, EvidenceDepth, SkillCategory } from '@prisma/client';

export interface SeedWorkExperience {
  key: string;
  company: string;
  title: string;
  location: string;
  startDate: Date;
  isCurrent: boolean;
}

export interface SeedProject {
  key: string;
  name: string;
  isShipped: boolean;
}

export interface SeedEvidence {
  context: EvidenceContext;
  depth: EvidenceDepth;
  whatIDid: string;
  lastUsed: Date;
  workExperience?: string; // SeedWorkExperience.key
  project?: string; // SeedProject.key
}

export interface SeedSkill {
  name: string;
  category: SkillCategory;
  evidence: SeedEvidence[];
}

export interface CareerData {
  workExperiences: SeedWorkExperience[];
  projects: SeedProject[];
  skills: SeedSkill[];
}

const NOW = new Date(); // currently in use, as of the day the seed runs
const UNIVERSITY = new Date('2023-07-01');

const cloudcard = (depth: EvidenceDepth, whatIDid: string): SeedEvidence => ({
  context: 'COMMERCIAL',
  depth,
  whatIDid,
  lastUsed: NOW,
  workExperience: 'cloudcard',
});

const builtAtCloudCard = (tech: string) =>
  cloudcard('PRODUCTION', `Used ${tech} to build frontend features that shipped to production at CloudCard.`);

const mern = (): SeedEvidence => ({
  context: 'PERSONAL',
  depth: 'WORKING',
  whatIDid: 'Built small self-taught MERN learning projects in 2024; picked the stack back up in 2026.',
  lastUsed: NOW,
});

const coursework = (tech: string): SeedEvidence => ({
  context: 'ACADEMIC',
  depth: 'EXPOSURE',
  whatIDid: `University coursework using ${tech}.`,
  lastUsed: UNIVERSITY,
});

export const CAREER_DATA: CareerData = {
  workExperiences: [
    {
      key: 'cloudcard',
      company: 'CloudCard Inc.',
      title: 'Frontend Developer',
      location: 'Lahore, Pakistan',
      startDate: new Date('2024-05-01'),
      isCurrent: true,
    },
  ],

  projects: [{ key: 'manzil', name: 'Manzil', isShipped: false }],

  skills: [
    // ── COMMERCIAL: CloudCard ────────────────────────────────────────────────
    { name: 'HTML5', category: 'LANGUAGE', evidence: [builtAtCloudCard('HTML5')] },
    { name: 'CSS', category: 'LANGUAGE', evidence: [builtAtCloudCard('CSS')] },
    { name: 'Tailwind CSS', category: 'FRAMEWORK', evidence: [builtAtCloudCard('Tailwind CSS')] },
    { name: 'JavaScript', category: 'LANGUAGE', evidence: [builtAtCloudCard('JavaScript')] },
    { name: 'TypeScript', category: 'LANGUAGE', evidence: [builtAtCloudCard('TypeScript')] },
    {
      name: 'React',
      category: 'LIBRARY',
      evidence: [
        builtAtCloudCard('React'),
        cloudcard('MAINTENANCE', 'Upgraded React versions across CloudCard apps (upgrade work, not primary development).'),
      ],
    },
    { name: 'Material UI', category: 'LIBRARY', evidence: [builtAtCloudCard('Material UI')] },
    { name: 'Ant Design', category: 'LIBRARY', evidence: [builtAtCloudCard('Ant Design')] },
    {
      name: 'Angular',
      category: 'FRAMEWORK',
      evidence: [
        cloudcard('MAINTENANCE', 'Upgraded Angular versions across CloudCard apps (upgrade work, not primary development).'),
      ],
    },
    { name: 'Ruby', category: 'LANGUAGE', evidence: [cloudcard('WORKING', 'Worked a little in Ruby at CloudCard.')] },
    {
      name: 'PostgreSQL',
      category: 'DATABASE',
      evidence: [cloudcard('PRODUCTION', 'Wrote PostgreSQL database migrations and added new tables and columns at CloudCard.')],
    },
    {
      name: 'SQL',
      category: 'LANGUAGE',
      evidence: [cloudcard('PRODUCTION', 'Wrote SQL for database migrations and schema changes at CloudCard.')],
    },
    {
      name: 'Role-based access control',
      category: 'CONCEPT',
      evidence: [cloudcard('PRODUCTION', 'Implemented role-based access control through database configuration at CloudCard.')],
    },
    {
      // Skill name is a placeholder for §6's "full understanding of the in-house Ruby
      // B2C layer" — rename it to how you'd describe it. This is NOT Azure B2C.
      name: 'API integration',
      category: 'CONCEPT',
      evidence: [
        cloudcard(
          'PRODUCTION',
          "Understand CloudCard's in-house Ruby B2C layer end to end — it sits between the frontend and a core Java backend.",
        ),
      ],
    },
    {
      name: 'SonarQube',
      category: 'TOOL',
      evidence: [cloudcard('PRODUCTION', 'Fixed SonarQube-reported errors in CloudCard code.')],
    },
    {
      name: 'Docker',
      category: 'TOOL',
      evidence: [cloudcard('WORKING', "Worked within CloudCard's Docker setup as a user of it, not the owner of the infrastructure.")],
    },
    {
      name: 'Docker Compose',
      category: 'TOOL',
      evidence: [cloudcard('WORKING', "Worked within CloudCard's Docker Compose setup as a user of it, not the owner.")],
    },
    {
      name: 'Microservices',
      category: 'CONCEPT',
      evidence: [cloudcard('WORKING', "Worked within CloudCard's microservices architecture from the frontend side; did not own the services.")],
    },

    // ── PERSONAL ─────────────────────────────────────────────────────────────
    {
      name: 'Next.js',
      category: 'FRAMEWORK',
      evidence: [
        {
          context: 'PERSONAL',
          depth: 'WORKING',
          whatIDid: 'Building the Manzil side project with Next.js (in progress, not yet shipped).',
          lastUsed: NOW,
          project: 'manzil',
        },
      ],
    },
    // Self-taught only. Never CloudCard experience — guarded in guards.ts.
    { name: 'Node.js', category: 'PLATFORM', evidence: [mern()] },
    { name: 'Express.js', category: 'FRAMEWORK', evidence: [mern()] },
    { name: 'MongoDB', category: 'DATABASE', evidence: [mern()] },

    // ── ACADEMIC (stale under the 2-year rule — kept for completeness) ───────
    { name: 'Python', category: 'LANGUAGE', evidence: [coursework('Python')] },
    { name: 'Flask', category: 'FRAMEWORK', evidence: [coursework('Flask')] },
    { name: 'Django', category: 'FRAMEWORK', evidence: [coursework('Django')] },
    { name: 'Java', category: 'LANGUAGE', evidence: [coursework('Java')] },
    { name: 'C++', category: 'LANGUAGE', evidence: [coursework('C++')] },
    { name: '.NET', category: 'PLATFORM', evidence: [coursework('.NET')] },
  ],
};
