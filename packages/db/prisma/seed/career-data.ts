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

const learning = (whatIDid: string, project?: string): SeedEvidence => ({
  context: 'PERSONAL',
  depth: 'EXPOSURE',
  whatIDid,
  lastUsed: NOW,
  ...(project ? { project } : {}),
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

  projects: [
    { key: 'manzil', name: 'Manzil', isShipped: false },
    { key: 'shortlist', name: 'Shortlist', isShipped: false },
  ],

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
        cloudcard(
          'MAINTENANCE',
          'Upgraded React versions across CloudCard apps (upgrade work, not primary development).',
        ),
      ],
    },
    { name: 'Material UI', category: 'LIBRARY', evidence: [builtAtCloudCard('Material UI')] },
    { name: 'Ant Design', category: 'LIBRARY', evidence: [builtAtCloudCard('Ant Design')] },
    {
      name: 'Angular',
      category: 'FRAMEWORK',
      evidence: [
        cloudcard(
          'MAINTENANCE',
          'Upgraded Angular versions across CloudCard apps (upgrade work, not primary development).',
        ),
      ],
    },
    { name: 'Ruby', category: 'LANGUAGE', evidence: [cloudcard('WORKING', 'Worked a little in Ruby at CloudCard.')] },
    {
      name: 'PostgreSQL',
      category: 'DATABASE',
      evidence: [
        cloudcard('PRODUCTION', 'Wrote PostgreSQL database migrations and added new tables and columns at CloudCard.'),
      ],
    },
    {
      name: 'SQL',
      category: 'LANGUAGE',
      evidence: [cloudcard('PRODUCTION', 'Wrote SQL for database migrations and schema changes at CloudCard.')],
    },
    {
      name: 'Role-based access control',
      category: 'CONCEPT',
      evidence: [
        cloudcard('PRODUCTION', 'Implemented role-based access control through database configuration at CloudCard.'),
      ],
    },
    {
      // Named and described by the user (2026-10-02). The B2C layer is in-house Ruby —
      // this is NOT Azure B2C.
      name: 'API Integration',
      category: 'CONCEPT',
      evidence: [
        cloudcard(
          'PRODUCTION',
          "Write Ruby functions and classes in CloudCard's in-house B2C layer (between the frontend and the core Java backend) that call backend API endpoints, expose them as GraphQL APIs, and consume those APIs in the frontend.",
        ),
      ],
    },
    {
      name: 'GraphQL',
      category: 'CONCEPT',
      evidence: [
        cloudcard('PRODUCTION', 'Expose Ruby-backed APIs as GraphQL and consume them from the frontend at CloudCard.'),
      ],
    },
    // Everyday tools, confirmed by the user as CloudCard work (2026-10-02).
    {
      name: 'Git',
      category: 'TOOL',
      evidence: [cloudcard('PRODUCTION', 'Use Git for version control in day-to-day work at CloudCard.')],
    },
    {
      name: 'REST APIs',
      category: 'CONCEPT',
      evidence: [cloudcard('PRODUCTION', 'Work with REST APIs in frontend features at CloudCard.')],
    },
    {
      name: 'npm',
      category: 'TOOL',
      evidence: [cloudcard('PRODUCTION', 'Use npm to manage dependencies and scripts at CloudCard.')],
    },
    {
      name: 'Prompt engineering',
      category: 'CONCEPT',
      // WORKING, not PRODUCTION: daily use of AI assistants is real but isn't "built a
      // feature that shipped". The user can raise it.
      evidence: [cloudcard('WORKING', 'Use prompting with AI assistants in day-to-day development work at CloudCard.')],
    },
    {
      name: 'SonarQube',
      category: 'TOOL',
      evidence: [cloudcard('PRODUCTION', 'Fixed SonarQube-reported errors in CloudCard code.')],
    },
    {
      name: 'Docker',
      category: 'TOOL',
      evidence: [
        cloudcard(
          'WORKING',
          "Worked within CloudCard's Docker setup as a user of it, not the owner of the infrastructure.",
        ),
      ],
    },
    {
      name: 'Docker Compose',
      category: 'TOOL',
      evidence: [
        cloudcard('WORKING', "Worked within CloudCard's Docker Compose setup as a user of it, not the owner."),
      ],
    },
    {
      name: 'Microservices',
      category: 'CONCEPT',
      evidence: [
        cloudcard(
          'WORKING',
          "Worked within CloudCard's microservices architecture from the frontend side; did not own the services.",
        ),
      ],
    },

    // ── PERSONAL ─────────────────────────────────────────────────────────────
    {
      name: 'Next.js',
      category: 'FRAMEWORK',
      evidence: [
        {
          // The user corrected this from WORKING to EXPOSURE (2026-10-02): still learning.
          context: 'PERSONAL',
          depth: 'EXPOSURE',
          whatIDid: 'Learning Next.js while building the Manzil side project (not yet shipped).',
          lastUsed: NOW,
          project: 'manzil',
        },
      ],
    },
    {
      name: 'pnpm',
      category: 'TOOL',
      evidence: [
        {
          context: 'PERSONAL',
          depth: 'WORKING',
          whatIDid: 'Use pnpm and pnpm workspaces in personal projects such as Shortlist.',
          lastUsed: NOW,
          project: 'shortlist',
        },
      ],
    },
    // Learning through building Shortlist (EXPOSURE, per the user, 2026-10-02). Worded so
    // they don't read as "built it on my own" — much of the code was written with an AI
    // assistant while the user learns each layer.
    ...(
      [
        ['NestJS', 'FRAMEWORK'],
        ['Prisma', 'LIBRARY'],
        ['Redis', 'DATABASE'],
        ['BullMQ', 'LIBRARY'],
        ['Zod', 'LIBRARY'],
        ['TanStack Query', 'LIBRARY'],
        ['Vite', 'TOOL'],
        ['Vitest', 'TOOL'],
      ] as const
    ).map(([name, category]): SeedSkill => ({
      name,
      category,
      evidence: [
        learning(
          `Learning ${name} while building the Shortlist project; not yet able to build with it independently.`,
          'shortlist',
        ),
      ],
    })),
    { name: 'NextAuth', category: 'LIBRARY', evidence: [learning('Learning NextAuth (authentication for Next.js).')] },
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
