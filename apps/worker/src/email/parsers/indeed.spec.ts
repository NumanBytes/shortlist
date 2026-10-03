import { readFileSync } from 'node:fs';
import { portalFor, senderDomain, toAlertEmail, workModeOf } from '../alert-email.js';
import { decodeQuotedPrintable, decodeWords, parseMail } from '../mime.js';
import { indeedParser } from './indeed.js';

// Real Indeed alerts captured 2026-10-03, scrubbed (scrub:email) before committing.
const fixture = (name: string) => readFileSync(new URL(`../../../test/fixtures/email/${name}`, import.meta.url));
const RECEIVED = new Date('2026-10-02T08:10:33Z');
const parse = (name: string) => indeedParser.parse(toAlertEmail(fixture(name), RECEIVED));

describe('Indeed alert parser', () => {
  it('reads every job in a daily alert, with a clean link to the posting', () => {
    const r = parse('indeed-alert.eml');
    if (r.kind !== 'jobs') throw new Error('expected jobs');
    expect(r.postings).toHaveLength(6);
    expect(r.postings[0]).toEqual({
      title: 'Full Stack Developer',
      company: 'WSL Consultants',
      location: 'Lahore',
      workMode: null,
      url: 'https://pk.indeed.com/viewjob?jk=70863ace132f8e01',
      externalId: '70863ace132f8e01',
      salary: 'From Rs 70,000 a month',
      snippet: expect.stringContaining('WSL Consultants (Pvt) Ltd is hiring an experienced Full Stack Developer'),
      postedAt: RECEIVED, // "Just posted"
    });
  });

  it('keeps hyphenated company names and multi-word locations apart', () => {
    const r = parse('indeed-alert.eml');
    if (r.kind !== 'jobs') throw new Error('expected jobs');
    expect(r.postings[2]).toMatchObject({
      company: 'BigLeap-Media',
      location: 'Lahore Allama Iqbal Town',
      salary: 'Rs 60,000 - Rs 70,000 a month',
      postedAt: new Date(RECEIVED.getTime() - 2 * 24 * 3600 * 1000), // "2 days ago"
    });
    expect(r.postings.every((p) => p.title && p.company && /^https:\/\/pk\.indeed\.com\/viewjob\?jk=[0-9a-f]+$/.test(p.url))).toBe(true);
  });

  it('also reads the jobs listed in an "alert is now active" confirmation', () => {
    const r = parse('indeed-alert-active.eml');
    if (r.kind !== 'jobs') throw new Error('expected jobs');
    expect(r.postings).toHaveLength(10);
    expect(r.postings[0]).toMatchObject({ title: 'Full Stack Engineer', company: 'Burq, Inc.', location: 'Lahore', externalId: null });
    // No job key in these links: the portal's own link is kept as-is.
    expect(r.postings[0]!.url).toMatch(/^https:\/\/engage\.indeed\.com\//);
  });

  it('says a confirmation with no jobs is not an alert (instead of "found nothing")', () => {
    expect(parse('indeed-alert-active-empty.eml')).toEqual({ kind: 'not_alert', reason: 'alert confirmation with no jobs yet' });
  });

  it('matches only the alerts sender', () => {
    expect(indeedParser.matches('donotreply@jobalert.indeed.com')).toBe(true);
    expect(indeedParser.matches('no-reply@indeed.com')).toBe(false);
  });
});

describe('alert email helpers', () => {
  it('extracts sender, subject and the HTML links', () => {
    const e = toAlertEmail(fixture('indeed-alert.eml'), RECEIVED);
    expect(e.sender).toBe('donotreply@jobalert.indeed.com');
    expect(e.subject).toMatch(/^Full Stack Developer at WSL Consultants/);
    expect(e.links.some((l) => l.url.includes('jk=70863ace132f8e01'))).toBe(true);
    expect(new Set(e.links.map((l) => l.url)).size).toBe(e.links.length); // de-duplicated
  });

  it('credits senders to portals by domain', () => {
    expect(senderDomain('donotreply@jobalert.indeed.com')).toBe('indeed.com');
    expect(senderDomain('alerts@mail.rozee.pk')).toBe('rozee.pk');
    expect(senderDomain('jobs@example.com.pk')).toBe('example.com.pk');
    expect(portalFor('team@hi.wellfound.com')).toEqual({ portal: 'wellfound', label: 'Wellfound' });
    expect(portalFor('jobs@newportal.io')).toEqual({ portal: 'newportal.io', label: 'newportal.io' });
  });

  it('reads work mode from location text', () => {
    expect(workModeOf('Remote')).toBe('REMOTE');
    expect(workModeOf('Hybrid work in Lahore')).toBe('HYBRID');
    expect(workModeOf('Lahore')).toBeNull();
  });
});

describe('MIME decoding', () => {
  it('decodes quoted-printable, including soft line breaks and UTF-8', () => {
    expect(decodeQuotedPrintable('Full Stack =E2=80=93 Fin=\nTech').toString('utf8')).toBe('Full Stack – FinTech');
  });

  it('decodes RFC 2047 encoded headers', () => {
    expect(decodeWords('=?UTF-8?B?Sm9icyDigJMgTGFob3Jl?=')).toBe('Jobs – Lahore');
    expect(decodeWords('=?utf-8?Q?New_jobs_=E2=80=93_today?=')).toBe('New jobs – today');
  });

  it('finds text and HTML in nested multipart with base64 and quoted-printable parts', () => {
    const raw = [
      'From: Portal <alerts@portal.example>',
      'Subject: =?UTF-8?Q?3_new_jobs?=',
      'Content-Type: multipart/mixed; boundary="outer"',
      '',
      '--outer',
      'Content-Type: multipart/alternative; boundary=inner',
      '',
      '--inner',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Senior React Engineer =E2=80=93 Acme',
      '--inner',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('<p>Senior React Engineer – Acme</p>').toString('base64'),
      '--inner--',
      '--outer',
      'Content-Type: application/pdf',
      'Content-Disposition: attachment; filename="x.pdf"',
      '',
      'JVBERi0=',
      '--outer--',
    ].join('\r\n');
    const m = parseMail(raw);
    expect(m.subject).toBe('3 new jobs');
    expect(m.text?.trim()).toBe('Senior React Engineer – Acme');
    expect(m.html).toBe('<p>Senior React Engineer – Acme</p>');
  });
});
