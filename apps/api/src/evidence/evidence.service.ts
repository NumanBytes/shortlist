import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateSkillEvidenceInput, UpdateSkillEvidenceInput } from '@shortlist/shared';
import { UNVERIFIED } from '../common/verification.js';
import { PrismaService } from '../prisma/prisma.service.js';

const NOT_FOUND = 'Evidence not found';

// Truthfulness rules (Agents.md §6) enforced here:
// - Evidence is always created unverified; `isVerified` never comes from a request body
//   (the Zod schemas are .strict() and have no such field).
// - verify() is the ONLY code path that sets isVerified = true.
// - Any edit un-verifies: what the user confirmed is no longer what's stored.
// - Links to a WorkExperience / Project must belong to the same user.
// - Another user's evidence is a 404, never a 403, so IDs can't be probed for existence.
@Injectable()
export class EvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateSkillEvidenceInput) {
    const skill = await this.prisma.skill.findFirst({ where: { id: input.skillId, userId } });
    if (!skill) throw new NotFoundException('Skill not found');
    await this.assertLinksOwned(userId, input);

    return this.prisma.skillEvidence.create({ data: input });
  }

  async update(userId: string, id: string, input: UpdateSkillEvidenceInput) {
    const existing = await this.findOwned(userId, id);
    await this.assertLinksOwned(userId, input);

    // The schema rejects both links in one request; this catches the other case —
    // setting one link while the stored row already has the other.
    const workExperienceId =
      input.workExperienceId !== undefined ? input.workExperienceId : existing.workExperienceId;
    const projectId = input.projectId !== undefined ? input.projectId : existing.projectId;
    if (workExperienceId && projectId) {
      throw new BadRequestException(
        'Evidence cannot be linked to both a work experience and a project — clear one first',
      );
    }

    return this.prisma.skillEvidence.update({
      where: { id },
      data: { ...input, ...UNVERIFIED },
    });
  }

  // The deliberate verification action — the user confirming "yes, this is true and
  // may appear on a resume". Idempotent: re-verifying keeps the original timestamp.
  async verify(userId: string, id: string) {
    const existing = await this.findOwned(userId, id);
    if (existing.isVerified) return existing;
    return this.prisma.skillEvidence.update({
      where: { id },
      data: { isVerified: true, verifiedAt: new Date() },
    });
  }

  async unverify(userId: string, id: string) {
    await this.findOwned(userId, id);
    return this.prisma.skillEvidence.update({
      where: { id },
      data: UNVERIFIED,
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.skillEvidence.deleteMany({
      where: { id, skill: { userId } },
    });
    if (count === 0) throw new NotFoundException(NOT_FOUND);
  }

  private async findOwned(userId: string, id: string) {
    // Ownership runs through the parent skill: evidence has no userId of its own.
    const evidence = await this.prisma.skillEvidence.findFirst({ where: { id, skill: { userId } } });
    if (!evidence) throw new NotFoundException(NOT_FOUND);
    return evidence;
  }

  private async assertLinksOwned(
    userId: string,
    links: { workExperienceId?: string | null; projectId?: string | null },
  ): Promise<void> {
    if (links.workExperienceId) {
      const found = await this.prisma.workExperience.count({
        where: { id: links.workExperienceId, userId },
      });
      if (!found) throw new BadRequestException('workExperienceId does not match any of your work experiences');
    }
    if (links.projectId) {
      const found = await this.prisma.project.count({ where: { id: links.projectId, userId } });
      if (!found) throw new BadRequestException('projectId does not match any of your projects');
    }
  }
}
