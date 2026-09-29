import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateSkillInput, UpdateSkillInput } from '@shortlist/shared';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { UNVERIFIED } from '../common/verification.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DUPLICATE = 'You already have a skill with this name';

@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  // The owner's own view: includes unverified evidence so it can be reviewed and
  // verified. Anything that feeds resume generation must filter isVerified = true.
  list(userId: string) {
    return this.prisma.skill.findMany({
      where: { userId },
      include: { evidence: { orderBy: { lastUsed: 'desc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async get(userId: string, id: string) {
    const skill = await this.prisma.skill.findFirst({
      where: { id, userId },
      include: { evidence: { orderBy: { lastUsed: 'desc' } } },
    });
    if (!skill) throw new NotFoundException('Skill not found');
    return skill;
  }

  async create(userId: string, input: CreateSkillInput) {
    try {
      return await this.prisma.skill.create({ data: { ...input, userId } });
    } catch (err) {
      // Case-insensitive: backed by the raw unique index on (userId, lower(name)).
      if (isUniqueViolation(err)) throw new ConflictException(DUPLICATE);
      throw err;
    }
  }

  async update(userId: string, id: string, input: UpdateSkillInput) {
    const existing = await this.get(userId, id);
    const renamed = input.name !== undefined && input.name !== existing.name;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Renaming un-verifies every piece of evidence under the skill. Evidence was
        // verified as proof of "React"; after a rename to "Azure" it would silently
        // vouch for a skill the user never confirmed — the exact shape of the
        // Azure B2C incident (Agents.md §1). The user must re-verify under the new name.
        if (renamed) {
          await tx.skillEvidence.updateMany({
            where: { skillId: id, isVerified: true },
            data: UNVERIFIED,
          });
        }
        return tx.skill.update({
          where: { id },
          data: input,
          include: { evidence: { orderBy: { lastUsed: 'desc' } } },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(DUPLICATE);
      throw err;
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    // deleteMany with userId in the filter = ownership check and delete in one query.
    const { count } = await this.prisma.skill.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Skill not found');
  }
}
