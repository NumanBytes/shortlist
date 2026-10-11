import type { ReactNode } from 'react';
import type { Education, PublicUser, ResumeBullet, ResumeContent } from '../lib/types';

// The resume in the user's own CV layout (docs/resume.md §13.1): centred name and contact line,
// then Experience, Skills, Projects, Education. Paper and ink colours stay the same in dark
// mode — it's a document. Printed with the browser's "Save as PDF", so the text stays
// selectable for applicant tracking systems.
//
// Sizes are in pt, measured from the user's CV (a Google Docs export, 2026-10-04): US
// Letter, 1in margins, Arial 11pt on a ~15.5pt line, name 18pt, contact 12pt. Bullets hang
// 18pt in with the text at 36pt, so wrapped lines align with the text, not the bullet.
// Experience and Projects use a large "●"; Skills a small "•". A blank line separates
// sections and projects.


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

// On screen, each bullet is a button: tapping it shows the evidence it was built from
// (the review sheet). A <button> prints as plain text, so the PDF is unchanged. It must be
// `block`: an inline-block button's baseline is its LAST line, which dropped the "●" marker
// to the bullet's last line in the PDF (caught by printing the real review page).
function Bullets({ bullets, onTap, selected }: { bullets: ResumeBullet[]; onTap?: (b: ResumeBullet) => void; selected?: ResumeBullet | null }) {
  return (
    <ul className={LIST}>
      {bullets.map((b, i) => {
        const text = (
          <>
            {b.label && <strong>{b.label}: </strong>}
            {b.text}
          </>
        );
        return (
          <BulletItem key={i} kind="dot">
            {onTap ? (
              <button
                type="button"
                aria-pressed={selected === b}
                onClick={() => onTap(b)}
                className={`-mx-1 block w-[calc(100%+0.5rem)] rounded px-1 text-left font-[inherit] leading-[inherit] text-ink transition hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent print:m-0 print:p-0 ${
                  selected === b ? 'bg-accent/15 ring-1 ring-accent print:bg-transparent print:ring-0' : ''
                }`}
              >
                {text}
              </button>
            ) : (
              text
            )}
          </BulletItem>
        );
      })}
    </ul>
  );
}

export function ResumeDocument({
  content,
  profile,
  education,
  draft,
  onBulletTap,
  selectedBullet,
}: {
  content: ResumeContent;
  profile: PublicUser;
  education: Education[];
  draft: boolean;
  onBulletTap?: (b: ResumeBullet) => void;
  selectedBullet?: ResumeBullet | null;
}) {
  const contact = [profile.email, profile.phone, profile.location].filter((x): x is string => !!x);
  const links = [profile.linkedinUrl, profile.githubUrl].filter((x): x is string => !!x);

  return (
    <div className="relative mx-auto w-full max-w-[8.5in] bg-paper px-[1in] py-[1in] font-[Arial,Helvetica,sans-serif] text-[11pt] leading-[15.5pt] text-ink shadow-sm ring-1 ring-border print:max-w-none print:p-0 print:shadow-none print:ring-0">
      {draft && (
        <>
          <p className="mb-3 hidden border border-ink py-1 text-center text-xs font-bold tracking-widest print:block">
            DRAFT — NOT YET APPROVED
          </p>
          {/* On screen, a faint diagonal watermark until it's approved (design board 3). */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden select-none print:hidden"
          >
            <span className="-rotate-[30deg] text-[96pt] font-bold tracking-[0.1em] text-ink/[0.05]">DRAFT</span>
          </span>
        </>
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
              <Bullets bullets={r.bullets} onTap={onBulletTap} selected={selectedBullet} />
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
              <Bullets bullets={p.bullets} onTap={onBulletTap} selected={selectedBullet} />
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
