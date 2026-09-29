import { Prisma } from '@shortlist/db';

// P2002 = unique constraint violation (including raw-SQL unique indexes).
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
