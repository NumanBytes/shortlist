import { Injectable } from '@nestjs/common';
import { STARTER_DISCOVERY_PREFERENCES, type DiscoveryPreferencesInput } from '@shortlist/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { CatalogService } from './catalog.service.js';

// What a user searches for, and the setup a new account needs (docs/discovery.md §9.13).
@Injectable()
export class SearchSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  // The rule filter's settings; `isDefault` while the user has never saved their own.
  async preferences(userId: string): Promise<{ preferences: DiscoveryPreferencesInput; isDefault: boolean }> {
    const row = await this.prisma.discoveryPreferences.findUnique({ where: { userId } });
    if (!row) return { preferences: STARTER_DISCOVERY_PREFERENCES, isDefault: true };
    const { id: _id, userId: _u, updatedAt: _t, ...preferences } = row;
    return { preferences, isDefault: false };
  }

  async savePreferences(userId: string, input: DiscoveryPreferencesInput) {
    await this.prisma.discoveryPreferences.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
    });
    return this.preferences(userId);
  }

  // Follows the remote-job boards listed in the shared catalog (docs/discovery.md §9.16).
  // Idempotent: boards already there — even ones the user switched off — are left on or off.
  addRemoteBoards(userId: string) {
    return this.catalog.followRemoteBoards(userId);
  }

  // Whether a new account still needs setting up: no search settings saved, no career data
  // and no sources. An account with any of them (like one seeded before onboarding existed)
  // is never sent to onboarding.
  async onboarding(userId: string) {
    const [prefs, roles, skills, sources] = await Promise.all([
      this.prisma.discoveryPreferences.count({ where: { userId } }),
      this.prisma.workExperience.count({ where: { userId } }),
      this.prisma.skill.count({ where: { userId } }),
      this.prisma.jobSource.count({ where: { userId } }),
    ]);
    return {
      needed: prefs + roles + skills + sources === 0,
      hasPreferences: prefs > 0,
      hasCareerData: roles + skills > 0,
      hasSources: sources > 0,
    };
  }
}
