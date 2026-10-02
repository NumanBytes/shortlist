import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { projectDatesProblem, type CreateProjectInput, type UpdateProjectInput } from '@shortlist/shared';
import { UNVERIFIED, claimChanged } from '../common/verification.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Fields that change what linked evidence claims. isShipped matters most: "shipped"
// is the line between a PRODUCTION-grade project and a WORKING one. URLs are excluded —
// moving a repo doesn't change what was built.
// workExperienceId too: linking a project to (or unlinking it from) a paid role decides
// whether its evidence counts as commercial work.
const CLAIM_FIELDS = ['name', 'description', 'isShipped', 'startDate', 'endDate', 'workExperienceId'] as const;

const WITH_EVIDENCE = {
  evidence: { include: { skill: { select: { id: true, name: true } } } },
} as const;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.project.findMany({
      where: { userId },
      include: WITH_EVIDENCE,
      // Undated projects sort last rather than first.
      orderBy: [{ startDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
  }

  async get(userId: string, id: string) {
    const found = await this.prisma.project.findFirst({ where: { id, userId }, include: WITH_EVIDENCE });
    if (!found) throw new NotFoundException('Project not found');
    return found;
  }

  async create(userId: string, input: CreateProjectInput) {
    await this.assertRoleOwned(userId, input.workExperienceId);
    return this.prisma.project.create({ data: { ...input, userId }, include: WITH_EVIDENCE });
  }

  // A project can only belong to one of the caller's own roles.
  private async assertRoleOwned(userId: string, workExperienceId: string | null | undefined) {
    if (!workExperienceId) return;
    const found = await this.prisma.workExperience.count({ where: { id: workExperienceId, userId } });
    if (!found) throw new BadRequestException('workExperienceId does not match any of your work experiences');
  }

  async update(userId: string, id: string, input: UpdateProjectInput) {
    const existing = await this.get(userId, id);
    await this.assertRoleOwned(userId, input.workExperienceId);

    const problem = projectDatesProblem({
      startDate: input.startDate !== undefined ? input.startDate : existing.startDate,
      endDate: input.endDate !== undefined ? input.endDate : existing.endDate,
    });
    if (problem) throw new BadRequestException(problem);

    const changed = claimChanged(CLAIM_FIELDS, input, existing);

    return this.prisma.$transaction(async (tx) => {
      if (changed) {
        await tx.skillEvidence.updateMany({ where: { projectId: id, isVerified: true }, data: UNVERIFIED });
      }
      return tx.project.update({ where: { id }, data: input, include: WITH_EVIDENCE });
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.get(userId, id);
    // Same reasoning as WorkExperienceService.remove: evidence survives (SET NULL) but
    // loses the context it was verified in.
    await this.prisma.$transaction([
      this.prisma.skillEvidence.updateMany({ where: { projectId: id, isVerified: true }, data: UNVERIFIED }),
      this.prisma.project.delete({ where: { id } }),
    ]);
  }
}
