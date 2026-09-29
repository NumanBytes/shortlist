import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  workDatesProblem,
  type CreateWorkExperienceInput,
  type UpdateWorkExperienceInput,
} from '@shortlist/shared';
import { UNVERIFIED, claimChanged } from '../common/verification.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Fields that change what linked evidence claims. Evidence verified as "at CloudCard,
// Frontend Dev, 2024–present" must not silently become a claim about a different
// company, title, or period. Location is excluded: it doesn't change the claim.
const CLAIM_FIELDS = ['company', 'title', 'startDate', 'endDate', 'isCurrent'] as const;

const WITH_EVIDENCE = {
  evidence: { include: { skill: { select: { id: true, name: true } } } },
} as const;

@Injectable()
export class WorkExperienceService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.workExperience.findMany({
      where: { userId },
      include: WITH_EVIDENCE,
      orderBy: { startDate: 'desc' },
    });
  }

  async get(userId: string, id: string) {
    const found = await this.prisma.workExperience.findFirst({ where: { id, userId }, include: WITH_EVIDENCE });
    if (!found) throw new NotFoundException('Work experience not found');
    return found;
  }

  create(userId: string, input: CreateWorkExperienceInput) {
    return this.prisma.workExperience.create({ data: { ...input, userId }, include: WITH_EVIDENCE });
  }

  async update(userId: string, id: string, input: UpdateWorkExperienceInput) {
    const existing = await this.get(userId, id);

    // A PATCH may carry only some date fields, so validate the merged result — e.g.
    // setting isCurrent: true on a role that already has an end date.
    const merged = {
      startDate: input.startDate ?? existing.startDate,
      endDate: input.endDate !== undefined ? input.endDate : existing.endDate,
      isCurrent: input.isCurrent ?? existing.isCurrent,
    };
    const problem = workDatesProblem(merged);
    if (problem) throw new BadRequestException(problem);

    const changed = claimChanged(CLAIM_FIELDS, input, existing);

    return this.prisma.$transaction(async (tx) => {
      if (changed) {
        await tx.skillEvidence.updateMany({
          where: { workExperienceId: id, isVerified: true },
          data: UNVERIFIED,
        });
      }
      return tx.workExperience.update({ where: { id }, data: input, include: WITH_EVIDENCE });
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.get(userId, id);
    await this.prisma.$transaction([
      // The FK is ON DELETE SET NULL, so linked evidence survives the delete — but it
      // was confirmed in the context of this role. Un-verify it so the user re-confirms
      // it standing on its own (or re-links it) before it can reach a resume.
      this.prisma.skillEvidence.updateMany({
        where: { workExperienceId: id, isVerified: true },
        data: UNVERIFIED,
      }),
      this.prisma.workExperience.delete({ where: { id } }),
    ]);
  }
}

