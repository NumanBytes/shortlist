// Seeds the builder's career data (career-data.ts) into an EXISTING account.
//
//   SEED_USER_EMAIL=you@example.com pnpm --filter @shortlist/db db:seed:career [--dry-run]
//
// - Register the account through the API first; this script never touches passwords.
// - Everything is created unverified. Review and verify each item via the API.
// - Additive and safe to re-run: existing roles, projects, skills, and evidence are
//   left exactly as they are, so edits and verifications are never overwritten.
//   Evidence counts as existing when its skill already has evidence with the same
//   context + depth, so rewording an item won't cause the original to be re-added.
import { PrismaClient } from '@prisma/client';
import { CAREER_DATA } from './career-data.ts';
import { findSeedProblems } from './guards.ts';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const email = process.env.SEED_USER_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('Set SEED_USER_EMAIL to the account to seed.');

  const problems = findSeedProblems(CAREER_DATA);
  if (problems.length) {
    throw new Error(`Refusing to seed — the data breaks truthfulness guards:\n  ${problems.join('\n  ')}`);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No account for ${email}. Register it through the API first.`);

    const counts: Counts = { workExperiences: 0, projects: 0, skills: 0, evidence: 0, skipped: 0 };

    await prisma.$transaction(async (tx) => {
      const workIds = new Map<string, string>();
      for (const w of CAREER_DATA.workExperiences) {
        const { key, ...data } = w;
        const found = await tx.workExperience.findFirst({
          where: { userId: user.id, company: data.company, title: data.title },
        });
        if (found) {
          workIds.set(key, found.id);
          counts.skipped++;
        } else {
          const created = await tx.workExperience.create({ data: { ...data, userId: user.id } });
          workIds.set(key, created.id);
          counts.workExperiences++;
        }
      }

      const projectIds = new Map<string, string>();
      for (const p of CAREER_DATA.projects) {
        const { key, ...data } = p;
        const found = await tx.project.findFirst({
          where: { userId: user.id, name: { equals: data.name, mode: 'insensitive' } },
        });
        if (found) {
          projectIds.set(key, found.id);
          counts.skipped++;
        } else {
          const created = await tx.project.create({ data: { ...data, userId: user.id } });
          projectIds.set(key, created.id);
          counts.projects++;
        }
      }

      for (const s of CAREER_DATA.skills) {
        let skill = await tx.skill.findFirst({
          where: { userId: user.id, name: { equals: s.name, mode: 'insensitive' } },
          include: { evidence: { select: { context: true, depth: true } } },
        });
        if (skill) {
          counts.skipped++;
        } else {
          skill = {
            ...(await tx.skill.create({ data: { userId: user.id, name: s.name, category: s.category } })),
            evidence: [],
          };
          counts.skills++;
        }

        for (const ev of s.evidence) {
          if (skill.evidence.some((e) => e.context === ev.context && e.depth === ev.depth)) {
            counts.skipped++;
            continue;
          }
          await tx.skillEvidence.create({
            // isVerified is deliberately not set: the column default (false) applies.
            data: {
              skillId: skill.id,
              context: ev.context,
              depth: ev.depth,
              whatIDid: ev.whatIDid,
              lastUsed: ev.lastUsed,
              workExperienceId: ev.workExperience ? workIds.get(ev.workExperience) : undefined,
              projectId: ev.project ? projectIds.get(ev.project) : undefined,
            },
          });
          counts.evidence++;
        }
      }

      // A dry run does all the reads and writes, reports, then throws to roll back —
      // so the plan it prints is exactly what a real run would do.
      if (dryRun) {
        report(email, counts, true);
        throw new DryRunRollback();
      }
    });

    report(email, counts, false);
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  } finally {
    await prisma.$disconnect();
  }
}

interface Counts {
  workExperiences: number;
  projects: number;
  skills: number;
  evidence: number;
  skipped: number;
}

function report(email: string, c: Counts, dry: boolean) {
  console.log(`${dry ? 'Dry run — would create' : 'Created'} for ${email}:`);
  console.log(
    `  ${c.workExperiences} work experiences, ${c.projects} projects, ${c.skills} skills, ${c.evidence} evidence`,
  );
  console.log(`  ${c.skipped} already present (left untouched)`);
  if (!dry && c.evidence > 0) {
    console.log('\nAll new evidence is UNVERIFIED. Review each item (GET /api/v1/skills), reword it');
    console.log('if needed (PATCH /api/v1/evidence/:id), then POST /api/v1/evidence/:id/verify.');
  }
}

// Thrown to roll the transaction back after a dry run has computed what it would do.
class DryRunRollback extends Error {}

try {
  await main();
} catch (err) {
  // Expected failures (missing email, no account, guard violations) are messages
  // for the person running the script, not crashes — skip the stack trace.
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
