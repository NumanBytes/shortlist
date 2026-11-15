import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  JobSourceConfigSchema,
  regionMatches,
  sourceFromLink,
  type AddCatalogEntryInput,
  type CatalogQuery,
  type UpdateCatalogEntryInput,
} from '@shortlist/shared';
import type { Prisma, SourceCatalogEntry } from '@shortlist/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueues } from '../queue/job-queues.js';

// Two configs are the same source if they hold the same values, whatever the key order
// (Postgres JSONB doesn't keep it).
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
        )
      : v;
export const sameConfig = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const providerOf = (config: unknown) => {
  const parsed = JobSourceConfigSchema.safeParse(config);
  return parsed.success ? parsed.data.provider : 'unknown';
};

type FollowResult = { sourceId: string; status: 'followed' | 'resumed' | 'already' };

// The shared source catalog (hosted Shortlist, Agents.md §2.1; docs/discovery.md §9.16). An admin
// curates it; any user follows from it. Following makes the user's own JobSource row, linked to
// the entry, so discovery, run history and health stay per user and the worker is unchanged.
// While linked, the entry decides the name and address: an admin's fix reaches every follower.
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueues,
  ) {}

  // ── For every user ──────────────────────────────────────────────────────────

  // Listed entries, searched by name and/or one place, each marked if the user follows it.
  async browse(userId: string, query: CatalogQuery) {
    const entries = await this.prisma.sourceCatalogEntry.findMany({
      where: {
        isListed: true,
        ...(query.q && { name: { contains: query.q, mode: 'insensitive' } }),
        ...(query.region && { regions: { has: query.region } }),
      },
      orderBy: { name: 'asc' },
      take: 200,
    });
    const mine = await this.prisma.jobSource.findMany({
      where: { userId, catalogEntryId: { in: entries.map((e) => e.id) } },
      select: { catalogEntryId: true, isEnabled: true },
    });
    const following = new Map(mine.map((s) => [s.catalogEntryId, s.isEnabled]));
    return entries.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      provider: providerOf(e.config),
      regions: e.regions,
      // Followed and switched on; a paused follow shows as not followed, so Follow resumes it.
      following: following.get(e.id) === true,
    }));
  }

  // Follow one entry. Following again a source the user paused turns it back on. The first run
  // is queued at once (best effort — tonight's run picks it up otherwise).
  async follow(userId: string, entryId: string) {
    const entry = await this.prisma.sourceCatalogEntry.findFirst({ where: { id: entryId, isListed: true } });
    if (!entry) throw new NotFoundException('Source not found');
    const result = await this.followEntry(userId, entry);
    if (result.status !== 'already') await this.queueFirstRuns([result.sourceId]);
    return { ...result, name: entry.name };
  }

  // Onboarding: follow every listed company that hires in one of these places — the remote
  // boards have their own button. A company the user already watches from a different link is
  // left as theirs.
  async followPlaces(userId: string, regions: string[]) {
    const entries = await this.prisma.sourceCatalogEntry.findMany({
      where: { isListed: true, type: { not: 'AGGREGATOR_API' } },
    });
    const followed: string[] = [];
    for (const entry of entries.filter((e) => regionMatches(e.regions, regions))) {
      const result = await this.followEntry(userId, entry).catch((err: unknown) => {
        if (err instanceof ConflictException) return null;
        throw err;
      });
      if (result && result.status !== 'already') followed.push(result.sourceId);
    }
    await this.queueFirstRuns(followed);
    return { followed: followed.length };
  }

  // The remote boards in one tap (docs/discovery.md §9.13), now from the catalog. Idempotent, and
  // never turns back on a board the user switched off: a board they already have is only linked.
  async followRemoteBoards(userId: string) {
    const boards = await this.prisma.sourceCatalogEntry.findMany({
      where: { isListed: true, type: 'AGGREGATOR_API' },
    });
    const existing = await this.prisma.jobSource.findMany({
      where: { userId, key: { in: boards.map((b) => b.key) } },
      select: { id: true, key: true, config: true, catalogEntryId: true },
    });
    let added = 0;
    for (const board of boards) {
      const have = existing.find((s) => s.key === board.key);
      if (!have) {
        await this.prisma.jobSource.create({ data: this.sourceData(userId, board) });
        added++;
      } else if (!have.catalogEntryId && sameConfig(have.config, board.config)) {
        await this.prisma.jobSource.update({ where: { id: have.id }, data: { catalogEntryId: board.id } });
      }
    }
    return { added };
  }

  // The listed entry with this key and the same address, if any: "Add a source" with a link the
  // catalog already has becomes a follow, so it gets the admin's fixes too.
  async matchingEntry(key: string, config: unknown) {
    const entry = await this.prisma.sourceCatalogEntry.findUnique({ where: { key } });
    return entry?.isListed && sameConfig(entry.config, config) ? entry : null;
  }

  private async followEntry(userId: string, entry: SourceCatalogEntry): Promise<FollowResult> {
    const existing = await this.prisma.jobSource.findUnique({
      where: { userId_key: { userId, key: entry.key } },
      select: { id: true, name: true, isEnabled: true, catalogEntryId: true, config: true },
    });
    if (!existing) {
      const created = await this.prisma.jobSource.create({
        data: this.sourceData(userId, entry),
        select: { id: true },
      });
      return { sourceId: created.id, status: 'followed' };
    }
    const linked = existing.catalogEntryId === entry.id;
    if (!linked && !sameConfig(existing.config, entry.config)) {
      throw new ConflictException(`You already watch “${existing.name}” from another link`);
    }
    if (linked && existing.isEnabled) return { sourceId: existing.id, status: 'already' };
    await this.prisma.jobSource.update({
      where: { id: existing.id },
      data: { catalogEntryId: entry.id, isEnabled: true },
    });
    return { sourceId: existing.id, status: existing.isEnabled ? 'already' : 'resumed' };
  }

  private sourceData(userId: string, entry: SourceCatalogEntry): Prisma.JobSourceUncheckedCreateInput {
    return {
      userId,
      key: entry.key,
      name: entry.name,
      type: entry.type,
      config: entry.config as Prisma.InputJsonValue,
      catalogEntryId: entry.id,
    };
  }

  private async queueFirstRuns(sourceIds: string[]) {
    await this.queue.enqueueSources(sourceIds, `follow-${Date.now()}`).catch(() => undefined);
  }

  // ── For an admin (AdminController) ──────────────────────────────────────────

  // Every entry, listed or not, with how many accounts follow it.
  async all() {
    const entries = await this.prisma.sourceCatalogEntry.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { sources: true } } },
    });
    return entries.map(({ _count, config, ...e }) => ({
      ...e,
      provider: providerOf(config),
      link: (config as { url?: unknown }).url ?? null,
      followers: _count.sources,
    }));
  }

  async add(input: AddCatalogEntryInput) {
    const parsed = sourceFromLink(input.name, input.link);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    const existing = await this.prisma.sourceCatalogEntry.findUnique({ where: { key: parsed.key } });
    if (existing) throw new ConflictException(`The catalog already has this as “${existing.name}”`);
    return this.prisma.sourceCatalogEntry.create({
      data: { key: parsed.key, name: input.name, type: parsed.type, config: parsed.config, regions: input.regions },
    });
  }

  // A new name or address is copied to every follower still linked, in one transaction; a new
  // address also clears their cooldown, so the fixed source can run at once. The key stays.
  async update(id: string, input: UpdateCatalogEntryInput) {
    const entry = await this.prisma.sourceCatalogEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Source not found');
    let moved: { type: 'ATS_BOARD' | 'MANUAL'; config: Prisma.InputJsonValue } | null = null;
    if (input.address !== undefined) {
      if (entry.type === 'AGGREGATOR_API') throw new BadRequestException("A job board's address can't be changed");
      const parsed = sourceFromLink(input.name ?? entry.name, input.address);
      if (!parsed.ok) throw new BadRequestException(parsed.error);
      moved = { type: parsed.type, config: parsed.config };
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.sourceCatalogEntry.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.regions !== undefined && { regions: input.regions }),
          ...(input.isListed !== undefined && { isListed: input.isListed }),
          ...moved,
        },
      });
      if (input.name !== undefined || moved) {
        await tx.jobSource.updateMany({
          where: { catalogEntryId: id },
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(moved && { ...moved, lastRunAt: null, lastRunStatus: null }),
          },
        });
      }
      return updated;
    });
  }

  // Followers keep their copy as their own source (the link is cleared); jobs stay.
  async remove(id: string) {
    const { count } = await this.prisma.sourceCatalogEntry.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException('Source not found');
  }
}
