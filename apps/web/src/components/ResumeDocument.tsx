import type { ReactNode } from 'react';
import type { Education, JobResume, PublicUser, ResumeBullet, ResumeContent } from '../lib/types';

// The resume in the user's own CV layout (Agents.md §13.1): centred name and contact line,
// then Experience, Skills, Projects, Education. Paper and ink colours stay the same in dark
// mode — it's a document. Printed with the browser's "Save as PDF", so the text stays
// selectable for applicant tracking systems.
//
// Sizes are in pt, measured from the user's CV (a Google Docs export, 2026-10-04): US
// Letter, 1in margins, Arial 11pt on a ~15.5pt line, name 18pt, contact 12pt. Bullets hang
// 18pt in with the text at 36pt, so wrapped lines align with the text, not the bullet.
// Experience and Projects use a large "●"; Skills a small "•". A blank line separates
// sections and projects.

type Sources = JobResume['sources'];

const monthYear = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

const LINE = 'mt-[15.5pt]'; // one blank line, as between the CV's sections and projects

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${LINE} break-inside-avoid-page`}>
      <h2 className="font-bold underline underline-offset-2">{title}</h2>
      {children}
    </section>
  );
}

// The CV's two bullet styles: a large "●" for Experience and Projects, a small "•" for
// Skills. A fixed-width marker column, then the text, so wrapped lines line up with the
// text. A flex row, not an absolutely positioned marker: positioned content is written to
// the PDF out of reading order (the headings first, the bullets after), and applicant
// tracking systems read that text order.
const MARKER = { dot: { glyph: '●', size: 'text-[12.5pt]' }, small: { glyph: '•', size: '' } } as const;

export function BulletItem({ kind, children }: { kind: keyof typeof MARKER; children: ReactNode }) {
  return (
    <li className="flex items-baseline">
      <span aria-hidden="true" className={`w-[18pt] shrink-0 ${MARKER[kind].size}`}>
        {MARKER[kind].glyph}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

const LIST = 'ml-[18pt] list-none';

function Bullets({ bullets, sources, showSources }: { bullets: ResumeBullet[]; sources: Sources; showSources: boolean }) {
  return (
    <ul className={LIST}>
      {bullets.map((b, i) => (
        <BulletItem key={i} kind="dot">
          {b.label && <strong>{b.label}: </strong>}
          {b.text}
          {showSources && (
            // Review aid only, never part of the resume: what the user wrote that this
            // bullet was made from. Styled as app UI (accent edge, UI font, a label) so it
            // can't be mistaken for a duplicate bullet, and hidden when printing.
            <div className="mt-1 mb-2 border-l-2 border-accent bg-apply-bg/40 py-1 pr-2 pl-2.5 font-sans text-xs leading-snug text-ink-muted not-italic print:hidden">
              <p className="mb-0.5 text-[10px] font-semibold tracking-wide text-accent uppercase">From your evidence</p>
              <ul className="space-y-0.5" aria-label="Sources">
              {b.evidenceIds.map((id) => {
                const s = sources[id];
                return (
                  <li key={id}>
                    {s ? (
                      <>
                        <span className="font-medium text-ink">{s.skillName}:</span> “{s.whatIDid}”
                        {!s.isVerified && <span className="text-ink-danger"> (no longer verified)</span>}
                      </>
                    ) : (
                      <span className="text-ink-danger">An item this bullet used was deleted</span>
                    )}
                  </li>
                );
              })}
              </ul>
            </div>
          )}
        </BulletItem>
      ))}
    </ul>
  );
}

export function ResumeDocument({
  content,
  profile,
  education,
  sources,
  showSources,
  draft,
}: {
  content: ResumeContent;
  profile: PublicUser;
  education: Education[];
  sources: Sources;
  showSources: boolean;
  draft: boolean;
}) {
  const contact = [profile.email, profile.phone, profile.location].filter((x): x is string => !!x);
  const links = [profile.linkedinUrl, profile.githubUrl].filter((x): x is string => !!x);

  return (
    <div className="mx-auto w-full max-w-[8.5in] bg-paper px-5 py-8 font-[Arial,Helvetica,sans-serif] text-[11pt] leading-[15.5pt] text-ink shadow-sm ring-1 ring-border sm:px-[1in] sm:py-[1in] print:max-w-none print:p-0 print:shadow-none print:ring-0">
      {draft && (
        <p className="mb-3 hidden border border-ink py-1 text-center text-xs font-bold tracking-widest print:block">
          DRAFT — NOT YET APPROVED
        </p>
      )}
      <header className="text-center">
        <h1 className="text-[18pt] leading-[22pt] font-bold">{profile.name}</h1>
        <p className="text-[12pt] leading-[17pt]">{contact.join(' | ')}</p>
        {links.length > 0 && (
          <p className="text-[12pt] leading-[17pt]">
            {links.map((l, i) => (
              <span key={l}>
                {i > 0 && ' | '}
                <a href={l} className="underline">
                  {bare(l)}
                </a>
              </span>
            ))}
          </p>
        )}
      </header>

      {content.experience.length > 0 && (
        <Section title="Experience">
          {content.experience.map((r, i) => (
            <div key={r.workExperienceId} className={`break-inside-avoid ${i > 0 ? LINE : ''}`}>
              <div className="flex justify-between gap-4">
                <p className="italic">
                  {r.title} | {r.company}
                </p>
                <p className="shrink-0">
                  {monthYear(r.startDate)} - {r.isCurrent || !r.endDate ? 'Present' : monthYear(r.endDate)}
                </p>
              </div>
              <Bullets bullets={r.bullets} sources={sources} showSources={showSources} />
            </div>
          ))}
        </Section>
      )}

      {content.skillGroups.length > 0 && (
        <Section title="Skills">
          <ul className={LIST}>
            {content.skillGroups.map((g) => (
              <BulletItem key={g.label} kind="small">
                <strong>{g.label}:</strong> {g.skills.map((s) => s.name).join(', ')}
              </BulletItem>
            ))}
          </ul>
        </Section>
      )}

      {content.projects.length > 0 && (
        <Section title="Projects">
          {content.projects.map((p, i) => (
            <div key={p.projectId} className={`break-inside-avoid ${i > 0 ? LINE : ''}`}>
              <p className="font-bold">{p.name}</p>
              <Bullets bullets={p.bullets} sources={sources} showSources={showSources} />
            </div>
          ))}
        </Section>
      )}

      {education.length > 0 && (
        <Section title="Education">
          {education.map((e) => (
            <div key={e.id} className="flex justify-between gap-4">
              <p className="italic">
                {e.degree} | {e.institution}
              </p>
              {(e.startYear || e.endYear) && (
                <p className="shrink-0">
                  {e.startYear ?? ''}
                  {e.startYear && ' - '}
                  {e.endYear ?? 'Present'}
                </p>
              )}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
