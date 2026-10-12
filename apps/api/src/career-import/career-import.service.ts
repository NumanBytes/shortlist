import { ConflictException, Injectable } from '@nestjs/common';
import type { ImportResumeInput } from '@shortlist/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueues } from '../queue/job-queues.js';

// "Import from my resume" (docs/career-data.md §7.6). The API only records the text and queues
// the work; the worker reads it with the model and writes everything UNVERIFIED.
const PUBLIC = {
  id: true,
  status: true,
  created: true,
  dropped: true,
  error: true,
  createdAt: true,
  finishedAt: true,
} as const; // never the text: it's only for the worker, and cleared once read

@Injectable()
export class CareerImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: JobQueues,
  ) {}

  async start(userId: string, input: ImportResumeInput) {
    const running = await this.prisma.careerImport.findFirst({ where: { userId, status: 'PENDING' } });
    if (running) throw new ConflictException('An import is already running — wait for it to finish');
    const row = await this.prisma.careerImport.create({ data: { userId, text: input.text }, select: PUBLIC });
    try {
      await this.queues.enqueueResumeImport(userId, row.id);
    } catch (err) {
      // Not queued: don't leave a PENDING row that blocks the next try, or the text behind.
      await this.prisma.careerImport.delete({ where: { id: row.id } });
      throw err;
    }
    return row;
  }

  latest(userId: string) {
    return this.prisma.careerImport.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: PUBLIC });
  }
}
