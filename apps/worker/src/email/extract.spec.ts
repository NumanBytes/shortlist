import { EMAIL_EXTRACTION_JSON_SCHEMA, EmailExtractionSchema, ExtractedWorkModeEnum, type EmailExtraction } from '@shortlist/shared';
import type { AlertEmail } from './alert-email.js';
import { buildExtractionPrompt, checkExtracted } from './extract.js';

const email: AlertEmail = {
  sender: 'jobs@arc.dev',
  subject: 'Remote roles for you',
  receivedAt: new Date('2026-10-03'),
  text: 'Senior React Engineer at Acme Corp — Remote, $4,000/month\nFull-Stack Dev (MERN) at Globex Pvt. Ltd.',
  links: [
    { url: 'https://arc.dev/j/acme', text: 'Senior React Engineer' },
    { url: 'https://arc.dev/j/globex', text: 'View role' },
    { url: 'https://arc.dev/settings', text: 'Email settings' },
  ],
};
const { refs, user, system } = buildExtractionPrompt(email);
const job = (over: Partial<EmailExtraction['jobs'][number]>): EmailExtraction['jobs'][number] => ({
  title: 'Senior React Engineer',
  company: 'Acme Corp',
  location: 'Remote',
  workMode: 'REMOTE',
  salary: '$4,000/month',
  link: 'L1',
  ...over,
});
const check = (jobs: EmailExtraction['jobs']) => checkExtracted({ isJobEmail: true, jobs }, email, refs);

describe('checkExtracted', () => {
  it('keeps a job that appears in the email, with the URL behind its link ref', () => {
    expect(check([job({})]).postings).toEqual([
      {
        title: 'Senior React Engineer',
        company: 'Acme Corp',
        location: 'Remote',
        workMode: 'REMOTE',
        url: 'https://arc.dev/j/acme',
        externalId: null,
        salary: '$4,000/month',
        snippet: null,
        postedAt: null,
      },
    ]);
  });

  it('matches across punctuation and case, but only whole words', () => {
    expect(check([job({ title: 'full stack dev (MERN)', company: 'GLOBEX PVT LTD', link: 'L2' })]).postings).toHaveLength(1);
    expect(check([job({ company: 'Acme' })]).postings).toHaveLength(1); // "Acme" is a whole word of "Acme Corp"
    expect(check([job({ company: 'Acm' })]).dropped[0]!.reason).toBe('company not in the email');
  });

  it('drops invented jobs, missing or unknown links, and duplicates', () => {
    const r = check([
      job({ title: 'Staff Engineer' }),
      job({ company: 'Initech' }),
      job({ link: null }),
      job({ link: 'L42' }),
      job({}),
      job({ title: 'senior react engineer' }),
    ]);
    expect(r.dropped.map((d) => d.reason)).toEqual([
      'title not in the email',
      'company not in the email',
      'no link to the posting',
      'no link to the posting',
      'duplicate',
    ]);
    expect(r.postings).toHaveLength(1);
  });

  it('turns UNKNOWN work mode into what the location says, or null', () => {
    expect(check([job({ workMode: 'UNKNOWN', location: 'Remote' })]).postings[0]!.workMode).toBe('REMOTE');
    expect(check([job({ workMode: 'UNKNOWN', location: null })]).postings[0]!.workMode).toBeNull();
  });
});

describe('buildExtractionPrompt', () => {
  it('lists links as refs and wraps the email as untrusted data', () => {
    expect(user).toContain('L1: "Senior React Engineer" → https://arc.dev/j/acme');
    expect(user).toMatch(/<email>[\s\S]*Acme Corp[\s\S]*<\/email>/);
    expect(system).toMatch(/untrusted text/);
    expect(refs.get('L3')).toBe('https://arc.dev/settings');
  });
});

describe('extraction JSON schema stays in sync with the Zod schema', () => {
  it('has the same fields and enum', () => {
    const s = EMAIL_EXTRACTION_JSON_SCHEMA;
    expect([...s.required].sort()).toEqual(Object.keys(EmailExtractionSchema.shape).sort());
    expect([...s.properties.jobs.items.required].sort()).toEqual(Object.keys(EmailExtractionSchema.shape.jobs.element.shape).sort());
    expect(s.properties.jobs.items.properties.workMode.enum).toEqual(ExtractedWorkModeEnum.options);
  });
});
