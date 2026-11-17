// Makes an existing account an admin, or a normal user again (Agents.md §2.1).
//
//   pnpm --filter @shortlist/db db:set-role you@example.com ADMIN
//   pnpm --filter @shortlist/db db:set-role you@example.com USER
//
// A command on the server rather than an API route: the first admin can't be made through
// the app (there is nobody to grant it yet), and no request body can ever make someone one.
import { PrismaClient } from '@prisma/client';

const ROLES = ['USER', 'ADMIN'] as const;
type Role = (typeof ROLES)[number];

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const role = process.argv[3]?.trim().toUpperCase() as Role | undefined;
  if (!email || !role || !ROLES.includes(role)) {
    throw new Error('Usage: db:set-role <email> <USER|ADMIN>');
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error(`No account for ${email}.`);
    await prisma.user.update({ where: { id: user.id }, data: { role } });
    console.log(`${email} is now ${role}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
