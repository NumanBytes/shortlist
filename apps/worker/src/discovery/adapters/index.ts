import type { AdapterRegistry } from '../types.js';
import { arbeitnow } from './arbeitnow.js';
import { greenhouse } from './greenhouse.js';
import { himalayas } from './himalayas.js';
import { jazzhr } from './jazzhr.js';
import { jobicy } from './jobicy.js';
import { lever } from './lever.js';
import { opencats } from './opencats.js';
import { remoteok } from './remoteok.js';
import { remotive } from './remotive.js';
import { simplicant } from './simplicant.js';
import { smartrecruiters } from './smartrecruiters.js';
import { weworkremotely } from './weworkremotely.js';
import { workable } from './workable.js';
import { zohorecruit } from './zohorecruit.js';

// Adding a source for an existing provider is a data change (a JobSource row).
// Adding a provider is one adapter here + one entry in ImplementedSourceConfigSchema;
// the AdapterRegistry type makes the compiler insist they stay in sync.
export const ADAPTERS: AdapterRegistry = {
  greenhouse,
  lever,
  smartrecruiters,
  workable,
  jazzhr,
  zohorecruit,
  opencats,
  simplicant,
  remoteok,
  remotive,
  arbeitnow,
  himalayas,
  jobicy,
  weworkremotely,
};
