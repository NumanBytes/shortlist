import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateEducationInput, UpdateEducationInput } from '@shortlist/shared';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class EducationService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.education.findMany({ where: { userId }, orderBy: [{ endYear: { sort: 'desc', nulls: 'first' } }, { startYear: 'desc' }] });
  }

  create(userId: string, input: CreateEducationInput) {
    return this.prisma.education.create({ data: { ...input, userId } });
  }

  async update(userId: string, id: string, input: UpdateEducationInput) {
    const existing = await this.prisma.education.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('Education not found');
    // A PATCH may carry only one year; check the merged result.
    const start = input.startYear !== undefined ? input.startYear : existing.startYear;
    const end = input.endYear !== undefined ? input.endYear : existing.endYear;
    if (start && end && end < start) throw new BadRequestException('End year cannot be before start year');
    return this.prisma.education.update({ where: { id }, data: input });
  }

  async remove(userId: string, id: string) {
    const { count } = await this.prisma.education.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Education not found');
  }
}
