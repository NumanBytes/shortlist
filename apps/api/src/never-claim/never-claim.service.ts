import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateNeverClaimInput } from '@shortlist/shared';
import { PrismaService } from '../prisma/prisma.service.js';

// The user's never-claim list (docs/resume.md §13.8). Tailoring refuses any bullet that
// mentions an entry, so it only ever changes through these user actions.
@Injectable()
export class NeverClaimService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.neverClaim.findMany({ where: { userId }, orderBy: { term: 'asc' } });
  }

  async create(userId: string, input: CreateNeverClaimInput) {
    // "azure" and "Azure" are one entry; the unique index alone is case-sensitive.
    const existing = await this.prisma.neverClaim.findFirst({
      where: { userId, scope: input.scope, term: { equals: input.term, mode: 'insensitive' } },
    });
    if (existing) throw new ConflictException(`"${existing.term}" is already on your list`);
    return this.prisma.neverClaim.create({ data: { ...input, userId } });
  }

  async remove(userId: string, id: string) {
    const { count } = await this.prisma.neverClaim.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Entry not found');
  }
}
