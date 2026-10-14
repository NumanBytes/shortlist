import { PROVIDER_LABELS } from '@shortlist/shared';
import type { JobListItem, Verdict } from './types';

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months < 24 ? `${months}mo ago` : `${Math.round(months / 12)}y ago`;
}

export const providerLabel = (provider: string | null) =>
  (provider && PROVIDER_LABELS[provider]) || provider || 'unknown';

export const AGGREGATORS = new Set(['remoteok', 'remotive', 'arbeitnow', 'himalayas', 'jobicy', 'weworkremotely']);
// Listed somewhere other than the company's own board — an aggregator or a job-alert email —
// so it's attributed "via <portal>", and its posting age means something.
export const isAggregator = (job: Pick<JobListItem, 'source' | 'jobSource'>) =>
  AGGREGATORS.has(job.source ?? '') || job.jobSource?.type === 'EMAIL_INBOX';

// Where a job came from, named so the user can tell their own company list from portals:
// "Kwanso careers" (a board on their list), "Remote OK" (aggregator), "LinkedIn alert" (email).
export function sourceName(job: Pick<JobListItem, 'source' | 'jobSource' | 'company'>): string {
  if (job.jobSource?.type === 'EMAIL_INBOX') return `${providerLabel(job.source)} alert`;
  if (isAggregator(job)) return providerLabel(job.source);
  return `${job.jobSource?.name ?? job.company} careers`;
}

// "Lahore, Punjab, pk" → "Lahore, Punjab, PK". Sources are inconsistent about case.
export function prettyLocation(location: string | null): string | null {
  if (!location) return null;
  return location
    .split(/\s*,\s*/)
    .map((part) => (/^[a-z]{2}$/i.test(part) ? part.toUpperCase() : part))
    .join(', ');
}

// Posting age only means something on aggregators (docs/discovery.md §9.6): a company board's
// publish date can be years old for a role that is still open, so don't show it there.
export function postedLabel(job: Pick<JobListItem, 'source' | 'postedAt' | 'jobSource'>): string | null {
  if (!job.postedAt || !isAggregator(job)) return null;
  return `posted ${timeAgo(job.postedAt)}`;
}

export const VERDICT_LABEL: Record<Verdict, string> = { APPLY: 'Apply', STRETCH: 'Stretch', SKIP: 'Skip' };

// "0:42", "12:05" — how long something has been waiting.
export function elapsed(sinceIso: string | null, now = Date.now()): string {
  if (!sinceIso) return '0:00';
  const secs = Math.max(0, Math.floor((now - new Date(sinceIso).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = String(secs % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// "in 3h", "in 25m" — for a time in the future.
export function timeUntil(iso: string, now = Date.now()): string {
  const mins = Math.max(1, Math.round((new Date(iso).getTime() - now) / 60_000));
  if (mins < 60) return `in ${mins}m`;
  return `in ${Math.round(mins / 60)}h`;
}

// The resume as plain text — for application forms that want it pasted, not uploaded.
// Same content and order as the printed page (docs/resume.md §13.1).
export function resumeText(
  content: {
    experience: {
      title: string;
      company: string;
      startDate: string;
      endDate: string | null;
      isCurrent: boolean;
      bullets: { label: string | null; text: string }[];
    }[];
    projects: { name: string; bullets: { label: string | null; text: string }[] }[];
    skillGroups: { label: string; skills: { name: string }[] }[];
  },
  profile: {
    name: string;
    email: string;
    phone: string | null;
    location: string | null;
    linkedinUrl: string | null;
    githubUrl: string | null;
  },
  education: { degree: string; institution: string; startYear: number | null; endYear: number | null }[],
): string {
  const my = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const bullet = (b: { label: string | null; text: string }) => `• ${b.label ? `${b.label}: ` : ''}${b.text}`;
  const lines = [
    profile.name,
    [profile.email, profile.phone, profile.location].filter(Boolean).join(' | '),
    [profile.linkedinUrl, profile.githubUrl].filter(Boolean).join(' | '),
  ];
  lines.push('', 'EXPERIENCE');
  for (const r of content.experience)
    lines.push(
      `${r.title} | ${r.company} — ${my(r.startDate)} - ${r.isCurrent || !r.endDate ? 'Present' : my(r.endDate)}`,
      ...r.bullets.map(bullet),
      '',
    );
  if (content.skillGroups.length)
    lines.push(
      'SKILLS',
      ...content.skillGroups.map((g) => `${g.label}: ${g.skills.map((s) => s.name).join(', ')}`),
      '',
    );
  if (content.projects.length) {
    lines.push('PROJECTS');
    for (const p of content.projects) lines.push(p.name, ...p.bullets.map(bullet), '');
  }
  if (education.length)
    lines.push(
      'EDUCATION',
      ...education.map(
        (e) =>
          `${e.degree} | ${e.institution}${e.startYear || e.endYear ? ` — ${e.startYear ?? ''} - ${e.endYear ?? 'Present'}` : ''}`,
      ),
    );
  return lines
    .filter((l, i, all) => !(l === '' && all[i - 1] === ''))
    .join('\n')
    .trim();
}

// "Chrome on Android" from a push device's user-agent string (UI audit P1) — the raw string
// meant nothing to a person choosing which device is which. Order matters: Edge, Opera and
// Samsung Internet all also claim to be Chrome, and Chrome claims to be Safari.
export function deviceName(userAgent: string | null): string {
  if (!userAgent) return 'A device';
  const ua = userAgent;
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox|FxiOS/.test(ua)
          ? 'Firefox'
          : /Chrome|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari/.test(ua)
              ? 'Safari'
              : 'A browser';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'ChromeOS'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Windows/.test(ua)
              ? 'Windows'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;
  return os ? `${browser} on ${os}` : browser;
}
