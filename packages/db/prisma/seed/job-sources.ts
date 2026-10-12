// The job sources to watch, from the list the user supplied (2026-10-01) plus the
// remote-job aggregators. Every source is recorded; only those with an adapter are
// enabled. Platform per company was identified by probing each careers URL.
//
// Turing is intentionally absent: it's a vetting marketplace (apply once, get matched),
// not a job board, so there is nothing to fetch.
import type { JobSourceType } from '@prisma/client';
import { PLANNED_PROVIDERS, REMOTE_BOARDS, type JobSourceConfig } from '@shortlist/shared';

export interface SeedJobSource {
  key: string;
  name: string;
  type: JobSourceType;
  config: JobSourceConfig;
  enabled: boolean;
}

const ats = (key: string, name: string, config: JobSourceConfig): SeedJobSource => ({
  key,
  name,
  type: 'ATS_BOARD',
  config,
  enabled: true,
});

const aggregator = (key: string, name: string, config: JobSourceConfig): SeedJobSource => ({
  key,
  name,
  type: 'AGGREGATOR_API',
  config,
  enabled: true,
});

// A hosted careers page (Milestone 2): the adapter reads the page itself. Same key scheme as
// `planned`, so rows seeded before the adapter existed are the same rows.
const hosted = (
  provider: 'jazzhr' | 'zohorecruit' | 'opencats',
  name: string,
  url: string,
  enabled = true,
): SeedJobSource => ({
  key: `${provider}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  name,
  type: 'ATS_BOARD',
  config: { provider, url },
  enabled,
});

// Recorded for later milestones; disabled until the provider has an adapter.
const planned = (
  provider: (typeof PLANNED_PROVIDERS)[number],
  name: string,
  url?: string,
  note?: string,
): SeedJobSource => ({
  key: `${provider}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  name,
  type: provider === 'email_alerts' ? 'EMAIL_INBOX' : provider === 'careers_page' ? 'MANUAL' : 'ATS_BOARD',
  config: { provider, ...(url ? { url } : {}), ...(note ? { note } : {}) },
  enabled: false,
});

export const JOB_SOURCES: SeedJobSource[] = [
  // ── Milestone 1: public ATS APIs ─────────────────────────────────────────
  ats('greenhouse:gomotive', 'Motive', { provider: 'greenhouse', board: 'gomotive' }),
  ats('greenhouse:careem', 'Careem', { provider: 'greenhouse', board: 'careem' }),
  ats('lever:educative', 'Educative', { provider: 'lever', site: 'educative' }),
  ats('lever:kwanso', 'Kwanso', { provider: 'lever', site: 'kwanso' }),
  ats('smartrecruiters:SeptemSystems', 'Septem Systems', { provider: 'smartrecruiters', company: 'SeptemSystems' }),
  ats('workable:hr-force', 'Programmers Force', { provider: 'workable', account: 'hr-force' }),

  // ── Milestone 1: remote-job aggregators (attribution + link-back required) ──
  // The same list onboarding offers every user (@shortlist/shared REMOTE_BOARDS).
  ...REMOTE_BOARDS.map((b) => aggregator(b.key, b.name, b.config)),

  // ── Milestone 2: hosted ATS pages (one parser per platform) ──────────────
  // Built 2026-10-13; probed live that day.
  hosted('jazzhr', 'VentureDive', 'https://venturedive.applytojob.com/apply'),
  hosted('jazzhr', 'NorthBay Solutions', 'https://northbay.applytojob.com/apply'),
  hosted('zohorecruit', 'ShopDev', 'https://shopdev.zohorecruit.com/jobs/Careers'),
  hosted('zohorecruit', 'Techlogix', 'https://techlogix.zohorecruit.com/jobs/Careers---Lahore'),
  // Its Zoho careers site answers with an error page (2026-10-13): off until it's back.
  hosted('zohorecruit', 'SlashNext', 'https://slashnext.zohorecruit.com/jobs/Careers', false),
  // games.tintash.com/careers links out to this Zoho site.
  hosted('zohorecruit', 'Tintash', 'https://tintash.zohorecruit.com/jobs/new-openings'),
  hosted('opencats', 'Intagleo', 'https://hr.intagleo.com/careers/index.php?m=careers&p=showAll'),
  hosted('opencats', 'i2c', 'https://careers.i2cinc.com/careers/index.php?m=careers&p=showAll'),
  planned('simplicant', '7Vals', 'https://7vals.simplicant.com/'),
  planned('webhr', 'UWorx', 'https://uworx.webhr.co/jobs/home/'),
  planned('hirestream', 'Cogent Labs', 'https://cogent-labs.hirestream.io/careers/'),
  planned(
    'successfactors',
    'Systemvent',
    'https://career55.sapsf.eu/career?company=systemvent&career_ns=job_listing_summary&navBarLevel=JOB_SEARCH',
  ),
  planned('pinpoint', 'Code District', 'https://codedistrict.com/job-details?2096874'),

  // ── Milestone 3: custom careers sites (change-detection + extraction) ────
  planned(
    'careers_page',
    'NetSol Technologies',
    'https://careers.netsoltech.com/?post_type=noo_job&action=live_search&location=lahore',
  ),
  planned('careers_page', 'Folio3', 'https://folio3.com/careers/'),
  planned('careers_page', 'Synavos', 'https://synavos.com/careers/'),
  planned('careers_page', 'BrainX', 'https://careers.brainxtech.com/'),
  planned('careers_page', 'Coeus Solutions', 'https://www.coeus-solutions.com/careers/'),
  planned('careers_page', 'Redmath', 'https://redmath.com/'),
  planned('careers_page', 'RipeSeed', 'https://ripeseed.io/'),
  planned('careers_page', 'Intech', 'https://www.intechww.com/careers/'),
  planned('careers_page', 'SSI', 'https://www.ssidecisions.com/careers/'),
  planned('careers_page', 'Cinnova', 'https://careers.cinnova.pk/current-openings/'),
  planned('careers_page', 'Rolustech', 'https://www.rolustech.com/jobs'),
  planned('careers_page', 'Xavor', 'https://www.xavor.com/careers/'),
  planned('careers_page', 'CodingCops', 'https://codingcops.com/about/'),
  planned('careers_page', 'Nextbridge', 'https://nextbridge.com/careers/'),
  planned('careers_page', 'The Developers Arena', 'https://www.thedevelopersarena.com/apply'),
  planned(
    'careers_page',
    'The TCM Group',
    'https://thetcmgroup.com/about/careers/',
    'Returned 403 to automated requests (2026-10-01)',
  ),
  planned('careers_page', 'Qbatch', 'https://qbatch.com/careers/', 'Careers page returned 404 (2026-10-01)'),
  planned(
    'careers_page',
    'Conrad Labs',
    'https://conradlabs.recruitease.simplisti.cc/recruitment/job-posts',
    'Domain did not resolve (2026-10-01)',
  ),

  // ── Milestone 3: job-alert emails (portals that forbid scraping / have no API) ──
  planned('email_alerts', 'Wellfound', undefined, 'No public API; ToS forbids scraping — use job-alert emails'),
  planned('email_alerts', 'LinkedIn', undefined, 'ToS forbids scraping — use job-alert emails'),
  planned('email_alerts', 'Rozee.pk', undefined, 'Use job-alert emails'),
  planned('email_alerts', 'remote.co', undefined, 'Refused automated connections — use job-alert emails'),
];
