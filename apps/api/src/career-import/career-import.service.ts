import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ImportResumeInput } from '@shortlist/shared';
import { isUniqueViolation } from '../common/prisma-errors.js';
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
} as const; // never the text: it's only for the worker, and cleared once the import ends

// A worker reads a resume in about a minute. An import still pending after this never will be
// (worker down, job lost) and must not block the next one.
const STALE_MS = 30 * 60_000;
const BUSY = 'An import is already running — wait for it to finish';

@Injectable()
export class CareerImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: JobQueues,
  ) {}

  async start(userId: string, input: ImportResumeInput) {
    await this.prisma.careerImport.updateMany({
      where: { userId, status: 'PENDING', createdAt: { lt: new Date(Date.now() - STALE_MS) } },
      data: { status: 'FAILED', error: 'It never finished — the worker may have been stopped', text: null },
    });
    // A newer import replaces one waiting on the budget; its text isn't kept for nothing.
    await this.prisma.careerImport.updateMany({
      where: { userId, status: 'DEFERRED' },
      data: { status: 'FAILED', error: 'Replaced by a newer import', text: null },
    });
    let row;
    try {
      // "One pending import per user" is a partial unique index, so two racing requests can't
      // both get in (a read-then-insert check could let both through).
      row = await this.prisma.careerImport.create({ data: { userId, text: input.text }, select: PUBLIC });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(BUSY);
      throw err;
    }
    await this.enqueueOrRollBack(row.id, () => this.prisma.careerImport.delete({ where: { id: row.id } }));
    return row;
  }

  // "Try again" on an import that was deferred (budget, credit, no API key). Its text was kept
  // for exactly this: deferred work is retried, never dropped.
  async retry(userId: string, id: string) {
    const { count } = await this.prisma.careerImport
      .updateMany({
        where: { id, userId, status: 'DEFERRED', text: { not: null } },
        data: { status: 'PENDING', error: null, finishedAt: null },
      })
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) throw new ConflictException(BUSY);
        throw err;
      });
    if (count === 0) throw new NotFoundException('No deferred import to retry');
    await this.enqueueOrRollBack(id, () =>
      this.prisma.careerImport.update({
        where: { id },
        data: { status: 'DEFERRED', error: 'Couldn’t queue it — try again' },
      }),
    );
    return this.prisma.careerImport.findUniqueOrThrow({ where: { id }, select: PUBLIC });
  }

  latest(userId: string) {
    return this.prisma.careerImport.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: PUBLIC });
  }

  // Not queued: don't leave a PENDING row behind that blocks the next try.
  private async enqueueOrRollBack(id: string, rollBack: () => Promise<unknown>) {
    try {
      await this.queues.enqueueResumeImport(id);
    } catch (err) {
      await rollBack();
      throw err;
    }
  }
}
