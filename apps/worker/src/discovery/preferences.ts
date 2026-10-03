import { DEFAULT_DISCOVERY_PREFERENCES, type DiscoveryPreferencesInput } from '@shortlist/shared';
import type { PrismaService } from '../prisma/prisma.service.js';

// The user's rule-filter settings (Agents.md §9.6) — data, not constants. Shared by board
// discovery and email alerts so both screen titles and locations the same way.
export async function loadPreferences(prisma: PrismaService, userId: string): Promise<DiscoveryPreferencesInput> {
  const row = await prisma.discoveryPreferences.findUnique({ where: { userId } });
  if (!row) return DEFAULT_DISCOVERY_PREFERENCES;
  const { id: _id, userId: _u, updatedAt: _t, ...prefs } = row;
  return prefs;
}
