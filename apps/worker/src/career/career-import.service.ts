import { Inject, Injectable, Logger } from '@nestjs/common';
import { CareerExtractionSchema, checkCareerExtraction, costUsd, type CheckedCareer } from '@shortlist/shared';
import { BudgetGuard } from '../analysis/budget-guard.js';
import { OutOfCreditError, PermanentAnalyzerError } from '../analysis/job-analyzer.js';
import { parseModelOutput } from '../analysis/model-output.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RESUME_READER, buildImportPrompt, type ResumeReader } from './resume-reader.js';

export type ImportOutcome =
  | { status: 'DONE'; created: ImportCounts; dropped: number }
  | { status: 'DEFERRED' | 'FAILED' | 'SKIPPED'; reason: string };

export interface ImportCounts {
  roles: number;
  projects: number;
  skills: number;
  evidence: number;
}

// "Import from my resume" (docs/career-data.md §7.6). The model reads the resume; code keeps
// only what it quotes word for word (checkCareerExtraction); everything is written UNVERIFIED
// and nothing the user already has is changed — the user confirms each item in Evidence.
@Injectable()
export class CareerImportService {
  private readonly logger = new Logger(CareerImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: BudgetGuard,
    @Inject(RESUME_READER) private readonly reader: ResumeReader,
  ) {}

  async run(importId: string): Promise<ImportOutcome> {
    const row = await this.prisma.careerImport.findUnique({ where: { id: importId } });
    if (!row || row.status !== 'PENDING' || !row.text) return { status: 'SKIPPED', reason: 'nothing to import' };
    const { userId, text } = row;

    if (!this.reader.configured) return this.finish(importId, 'DEFERRED', 'ANTHROPIC_API_KEY is not set in the worker');
    const guard = await this.budget.checkMonthly(userId);
    if (!guard.allowed) return this.finish(importId, 'DEFERRED', guard.reason);

    let result;
    try {
      result = await this.reader.read(buildImportPrompt(text));
    } catch (err) {
      if (err instanceof OutOfCreditError) return this.finish(importId, 'DEFERRED', err.message);
      if (err instanceof PermanentAnalyzerError) return this.finish(importId, 'FAILED', err.message);
      throw err; // transient: the queue retries
    }

    // Log the spend before anything else: the call was billed whatever happens next.
    const parsed = parseModelOutput(result.text, result.stopReason, CareerExtractionSchema, 'read this resume');
    await this.prisma.aiUsage.create({
      data: {
        userId,
        purpose: 'IMPORT_RESUME',
        model: result.model,
        ...result.usage,
        costUsd: costUsd(result.model, result.usage),
        succeeded: parsed.ok,
      },
    });
    if (!parsed.ok) return this.finish(importId, 'FAILED', parsed.reason);

    const neverClaim = await this.prisma.neverClaim.findMany({
      where: { userId },
      select: { term: true, scope: true },
    });
    const checked = checkCareerExtraction(text, parsed.value, neverClaim);
    const created = await this.store(userId, checked);
    await this.prisma.careerImport.update({
      where: { id: importId },
      data: { status: 'DONE', text: null, created: { ...created }, dropped: checked.dropped, finishedAt: new Date() },
    });
    this.logger.log(
      `Import ${importId}: ${created.roles} roles, ${created.projects} projects, ${created.skills} skills, ${created.evidence} items; ${checked.dropped.length} dropped`,
    );
    return { status: 'DONE', created, dropped: checked.dropped.length };
  }

  // A transient failure on the last attempt: say so, or the import would show as running forever.
  async fail(importId: string, reason: string) {
    await this.finish(importId, 'FAILED', reason);
  }

  // Ends an import without a result. The text is personal data: cleared either way.
  private async finish(importId: string, status: 'DEFERRED' | 'FAILED', reason: string): Promise<ImportOutcome> {
    await this.prisma.careerImport.updateMany({
      where: { id: importId, status: 'PENDING' },
      data: { status, error: reason, text: null, finishedAt: new Date() },
    });
    return { status, reason };
  }

  // Adds what's new; reuses what the user already has (same role, project or skill name);
  // never edits or re-verifies an existing row. isVerified is never set: the default (false)
  // is the Azure-incident safeguard (Agents.md §6).
  private store(userId: string, c: CheckedCareer): Promise<ImportCounts> {
    return this.prisma.$transaction(async (tx) => {
      const counts: ImportCounts = { roles: 0, projects: 0, skills: 0, evidence: 0 };
      const ci = (value: string) => ({ equals: value, mode: 'insensitive' as const });

      const roleIds = new Map<string, string>();
      for (const r of c.roles) {
        const found = await tx.workExperience.findFirst({
          where: { userId, company: ci(r.company), title: ci(r.title) },
          select: { id: true },
        });
        const id =
          found?.id ??
          (
            await tx.workExperience.create({
              data: {
                userId,
                company: r.company,
                title: r.title,
                location: r.location,
                startDate: r.startDate,
                endDate: r.endDate,
                isCurrent: r.isCurrent,
              },
            })
          ).id;
        if (!found) counts.roles++;
        roleIds.set(r.ref, id);
      }

      const projectIds = new Map<string, string>();
      for (const p of c.projects) {
        const found = await tx.project.findFirst({ where: { userId, name: ci(p.name) }, select: { id: true } });
        const id =
          found?.id ??
          (
            await tx.project.create({
              data: {
                userId,
                name: p.name,
                description: p.description,
                workExperienceId: p.roleRef ? (roleIds.get(p.roleRef) ?? null) : null,
              },
            })
          ).id;
        if (!found) counts.projects++;
        projectIds.set(p.ref, id);
      }

      const skillIds = new Map<string, string>();
      const skillId = async (name: string, category: CheckedCareer['listedSkills'][number]['category']) => {
        const key = name.toLowerCase();
        const known = skillIds.get(key);
        if (known) return known;
        const found = await tx.skill.findFirst({ where: { userId, name: ci(name) }, select: { id: true } });
        const id = found?.id ?? (await tx.skill.create({ data: { userId, name, category } })).id;
        if (!found) counts.skills++;
        skillIds.set(key, id);
        return id;
      };

      for (const i of c.items) {
        const sid = await skillId(i.skill, i.category);
        const duplicate = await tx.skillEvidence.findFirst({
          where: { skillId: sid, whatIDid: ci(i.whatIDid) },
          select: { id: true },
        });
        if (duplicate) continue;
        await tx.skillEvidence.create({
          data: {
            skillId: sid,
            context: i.context,
            depth: i.depth,
            whatIDid: i.whatIDid,
            lastUsed: i.lastUsed,
            // One source at most (chk_evidence_single_source): a project's item links the project.
            workExperienceId: i.roleRef ? (roleIds.get(i.roleRef) ?? null) : null,
            projectId: i.projectRef ? (projectIds.get(i.projectRef) ?? null) : null,
          },
        });
        counts.evidence++;
      }
      for (const k of c.listedSkills) await skillId(k.name, k.category);
      return counts;
    });
  }
}
