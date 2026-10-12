import { PermanentSourceError } from '../errors.js';
import { getText } from '../http.js';
import { mapPostings } from '../postings.js';
import { decodeEntities, htmlToText, joinParts } from '../text.js';
import type { Adapter, Posting } from '../types.js';

// Zoho Recruit career sites (<company>.zohorecruit.com/jobs/<portal>). No public API, but the
// page carries its openings as JSON in a hidden <input id="jobs">, and each job page carries
// its own record — description included — in `var jobs = JSON.parse('…')` (docs/discovery.md §9.3).
interface ZohoJob {
  id: string;
  Posting_Title?: string;
  Job_Opening_Name?: string;
  City?: string;
  State?: string;
  Country?: string;
  Remote_Job?: boolean | string;
  Publish?: boolean | string;
  Job_Description?: string;
}

const yes = (v: unknown) => v === true || v === 'true' || v === 'True';
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

// A JavaScript single-quoted string literal's content → the string it denotes.
function jsString(literal: string): string {
  return literal.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (_, e: string) => {
    if (e[0] === 'x' || e[0] === 'u') return String.fromCharCode(parseInt(e.slice(1), 16));
    return ({ n: '\n', r: '\r', t: '\t' } as Record<string, string>)[e] ?? e;
  });
}

export function zohoJobs(html: string): ZohoJob[] | null {
  const m = /value="([^"]*)"\s+id="jobs"/.exec(html);
  return m ? (JSON.parse(decodeEntities(m[1]!)) as ZohoJob[]) : null;
}

export function zohoJobPageRecords(html: string): ZohoJob[] {
  const m = /var jobs = JSON\.parse\('((?:[^'\\]|\\.)*)'\)/.exec(html);
  return m ? (JSON.parse(jsString(m[1]!)) as ZohoJob[]) : [];
}

export const zohorecruit: Adapter<{ provider: 'zohorecruit'; url: string }> = async ({ url }, ctx) => {
  const listing = url.replace(/\/+$/, '');
  const jobs = zohoJobs(await getText(listing));
  // A careers page that no longer exists still answers 200, without the job list.
  if (!jobs)
    throw new PermanentSourceError(`No Zoho Recruit job list at ${listing} — is the careers site still published?`);

  return mapPostings(
    jobs.filter((j) => j.Publish === undefined || yes(j.Publish)),
    ctx,
    (j): Posting => {
      const title = (j.Posting_Title || j.Job_Opening_Name)!.trim();
      const jobUrl = `${listing}/${j.id}/${slug(title)}`;
      return {
        externalId: j.id,
        title,
        company: ctx.sourceName,
        location: joinParts(j.City, j.State, j.Country),
        workMode: yes(j.Remote_Job) ? 'REMOTE' : null,
        url: jobUrl,
        postedAt: null,
        description: null,
        loadDescription: async () => {
          const record = zohoJobPageRecords(await getText(jobUrl)).find((r) => r.id === j.id);
          return record?.Job_Description ? htmlToText(record.Job_Description) : '';
        },
      };
    },
  );
};
