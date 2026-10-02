import type { ReactNode } from 'react';
import type { Education, JobResume, PublicUser, ResumeBullet, ResumeContent } from '../lib/types';

// The resume in the user's own CV layout (Agents.md §13.1): centred name and contact line,
// then Experience, Skills, Projects, Education. Paper and ink colours stay the same in dark
// mode — it's a document. Printed with the browser's "Save as PDF", so the text stays
// selectable for applicant tracking systems.

type Sources = JobResume['sources'];

const monthYear = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 break-inside-avoid-page">
      <h2 className="mb-1 font-bold underline underline-offset-2">{title}</h2>
      {children}
    </section>
  );
}

function Bullets({ bullets, sources, showSources }: { bullets: ResumeBullet[]; sources: Sources; showSources: boolean }) {
  return (
    <ul className="ml-5 list-disc space-y-0.5">
      {bullets.map((b, i) => (
        <li key={i} className="pl-1">
          {b.label && <strong>{b.label}: </strong>}
          {b.text}
          {showSources && (
            // Review aid only: what the user wrote that this bullet was made from.
            <ul className="mt-1 mb-1.5 space-y-0.5 rounded bg-ink/5 px-2 py-1.5 text-xs text-ink-muted print:hidden" aria-label="Sources">
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
          )}
        </li>
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
    <div className="mx-auto w-full max-w-[210mm] bg-paper px-6 py-8 font-[Arial,Helvetica,sans-serif] text-[13px] leading-snug text-ink shadow-sm ring-1 ring-border sm:px-12 sm:py-10 print:max-w-none print:p-0 print:text-[10.5pt] print:shadow-none print:ring-0">
      {draft && (
        <p className="mb-3 hidden border border-ink py-1 text-center text-xs font-bold tracking-widest print:block">
          DRAFT — NOT YET APPROVED
        </p>
      )}
      <header className="text-center">
        <h1 className="text-2xl font-bold">{profile.name}</h1>
        <p className="mt-0.5">{contact.join(' | ')}</p>
        {links.length > 0 && (
          <p>
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
          {content.experience.map((r) => (
            <div key={r.workExperienceId} className="mb-2 break-inside-avoid">
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
          <ul className="ml-5 list-disc space-y-0.5">
            {content.skillGroups.map((g) => (
              <li key={g.label} className="pl-1">
                <strong>{g.label}:</strong> {g.skills.map((s) => s.name).join(', ')}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {content.projects.length > 0 && (
        <Section title="Projects">
          {content.projects.map((p) => (
            <div key={p.projectId} className="mb-2 break-inside-avoid">
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
