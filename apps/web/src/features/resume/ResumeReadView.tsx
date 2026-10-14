import type { Education, ResumeBullet, ResumeContent } from '../../lib/types';
import { SectionLabel } from '../../components/ui';

const monthYear = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

// The phone's way to review a resume (UI audit R1, docs/web-design.md §8.6): the same content
// as the page, reflowed at reading size, every bullet a full-width row that opens the
// evidence behind it. The page itself (scaled to fit, ~6px text on a phone) is one tap away
// as "Page", and it is what prints, whichever view is showing.
export function ResumeReadView({
  content,
  education,
  onBulletTap,
  selectedBullet,
}: {
  content: ResumeContent;
  education: Education[];
  onBulletTap: (b: ResumeBullet) => void;
  selectedBullet: ResumeBullet | null;
}) {
  const bullets = (list: ResumeBullet[]) => (
    <ul className="divide-y divide-border">
      {list.map((b, i) => (
        <li key={i}>
          <button
            type="button"
            aria-pressed={selectedBullet === b}
            onClick={() => onBulletTap(b)}
            className={`flex min-h-12 w-full gap-2.5 px-4 py-3 text-left text-body text-fg transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${selectedBullet === b ? 'bg-accent-soft' : ''}`}
          >
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-muted" />
            <span>
              {b.label && <strong className="font-semibold">{b.label}: </strong>}
              {b.text}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
  const card = 'overflow-hidden rounded-lg border border-border bg-surface';

  return (
    <div className="space-y-4">
      {content.experience.length > 0 && (
        <section className="space-y-2" aria-label="Experience">
          <SectionLabel>Experience</SectionLabel>
          {content.experience.map((r) => (
            <div key={r.workExperienceId} className={card}>
              <div className="border-b border-border px-4 pt-3 pb-2.5">
                <p className="text-body font-semibold text-fg">
                  {r.title} · {r.company}
                </p>
                <p className="text-footnote text-muted">
                  {monthYear(r.startDate)} – {r.isCurrent || !r.endDate ? 'Present' : monthYear(r.endDate)}
                </p>
              </div>
              {bullets(r.bullets)}
            </div>
          ))}
        </section>
      )}

      {content.projects.length > 0 && (
        <section className="space-y-2" aria-label="Projects">
          <SectionLabel>Projects</SectionLabel>
          {content.projects.map((p) => (
            <div key={p.projectId} className={card}>
              <p className="border-b border-border px-4 pt-3 pb-2.5 text-body font-semibold text-fg">{p.name}</p>
              {bullets(p.bullets)}
            </div>
          ))}
        </section>
      )}

      {content.skillGroups.length > 0 && (
        <section className="space-y-2" aria-label="Skills">
          <SectionLabel>Skills</SectionLabel>
          <dl className={`${card} divide-y divide-border`}>
            {content.skillGroups.map((g) => (
              <div key={g.label} className="px-4 py-3 text-body">
                <dt className="inline font-semibold text-fg">{g.label}: </dt>
                <dd className="inline text-fg">{g.skills.map((s) => s.name).join(', ')}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {education.length > 0 && (
        <section className="space-y-2" aria-label="Education">
          <SectionLabel>Education</SectionLabel>
          <ul className={`${card} divide-y divide-border`}>
            {education.map((e) => (
              <li key={e.id} className="px-4 py-3">
                <p className="text-body font-semibold text-fg">{e.degree}</p>
                <p className="text-footnote text-muted">
                  {[
                    e.institution,
                    e.startYear || e.endYear ? `${e.startYear ?? '?'} – ${e.endYear ?? 'present'}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
