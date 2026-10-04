import { AlertTriangle, Check, ChevronLeft, Download, ShieldX, ZoomIn } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ResumeDocument } from '../components/ResumeDocument';
import { useToast } from '../components/Toast';
import { Badge, Button, EmptyState, Sheet, Skeleton, buttonStyles } from '../components/ui';
import { useApproveResume, useEducation, useJobDetail, useJobResume, useProfile } from '../lib/queries';
import type { JobResume, ResumeBullet } from '../lib/types';

const PAGE_PX = 816; // US Letter at 96 dpi — the printed page (Agents.md §13.1)
const monthYear = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// Review → approve → print (design board 3). Printing is offered only for an approved,
// up-to-date resume: every new resume is read before it goes out (Agents.md §13.2). A
// draft printed anyway (Ctrl+P) carries a DRAFT banner.
export function ResumePage() {
  const { jobId = '' } = useParams();
  const job = useJobDetail(jobId, true);
  const resume = useJobResume(jobId, true);
  const profile = useProfile();
  const education = useEducation();
  const approve = useApproveResume();
  const toast = useToast();
  const [bullet, setBullet] = useState<ResumeBullet | null>(null);

  // The browser names the saved PDF after the page title.
  const name = profile.data?.name;
  const company = job.data?.company;
  useEffect(() => {
    if (!name || !company) return;
    const previous = document.title;
    document.title = `${name} - Resume - ${company}`;
    return () => {
      document.title = previous;
    };
  }, [name, company]);

  const nav = (
    <nav className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 print:hidden">
      <Link to={`/jobs/${jobId}`} className="-ml-1 flex min-h-11 min-w-0 items-center gap-0.5 text-[17px] font-medium text-accent-fg">
        <ChevronLeft className="size-6 shrink-0" />
        <span className="truncate">{company ?? 'Job'}</span>
      </Link>
      <h1 className="text-[15px] font-semibold whitespace-nowrap text-fg">Review resume</h1>
      <span />
    </nav>
  );

  if (resume.isPending || profile.isPending || education.isPending || job.isPending) {
    return (
      <div className="mx-auto max-w-[8.5in] space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }
  const v = resume.data?.variant;
  if (!v || !profile.data || !resume.data) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        {nav}
        <EmptyState icon={<AlertTriangle className="size-6" />} title="No resume for this job yet">
          Open the job and choose “Tailor a resume”.
        </EmptyState>
      </div>
    );
  }

  const stale = v.stale.length > 0;
  const approved = v.status === 'APPROVED';
  const { dropped } = v.content;

  return (
    <div className="mx-auto max-w-[8.5in] space-y-3 pb-28 sm:pb-6 print:space-y-0 print:p-0">
      {nav}
      <div className="flex items-center gap-2 print:hidden">
        <Badge className="font-semibold tracking-[0.04em]" tone={stale ? 'danger' : approved ? 'accent' : 'neutral'}>
          {stale ? 'OUT OF DATE' : approved ? 'APPROVED' : 'DRAFT'}
        </Badge>
        <p className="text-xs text-muted">Tap any bullet to see the evidence behind it.</p>
      </div>

      {stale && (
        <p className="flex gap-2 rounded-xl bg-danger-bg px-3 py-2.5 text-sm text-danger-fg print:hidden">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Evidence it uses has changed ({v.stale.join(' · ')}). Tailor it again from the job page before sending.
        </p>
      )}

      {/* The "desk": the page on a tinted band, scaled to fit a phone (pinch to zoom). */}
      <div className="-mx-4 bg-surface-2 px-4 py-5 sm:mx-0 sm:rounded-2xl print:m-0 print:bg-transparent print:p-0">
        <FitToWidth>
          <ResumeDocument
            content={v.content}
            profile={profile.data}
            education={education.data ?? []}
            draft={!approved || stale}
            onBulletTap={setBullet}
            selectedBullet={bullet}
          />
        </FitToWidth>
        <p className="mt-3 flex justify-center print:hidden">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-xs text-muted sm:hidden">
            <ZoomIn className="size-3.5" /> Pinch to zoom
          </span>
        </p>
      </div>

      {dropped.length > 0 && (
        <section aria-labelledby="removed" className="space-y-2.5 pt-2 print:hidden">
          <h2 id="removed" className="px-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
            Removed by checks · <span className="tabular-nums">{dropped.length}</span>
          </h2>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {dropped.map((d, i) => (
              <li key={i} className="space-y-2 px-4 py-3.5">
                <p className="text-sm text-muted line-through">{d.text}</p>
                <p className="flex items-start gap-1.5 text-sm font-medium text-danger-fg">
                  <ShieldX className="mt-px size-4 shrink-0" />
                  <span>
                    {d.reason}
                    <span className="font-normal text-muted"> · {d.where}</span>
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Sticky on phones: the one decision this screen is for. */}
      <div className="fixed inset-x-0 bottom-0 z-20 space-y-2 border-t border-border bg-glass px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none print:hidden">
        {approved && !stale ? (
          <Button size="lg" className="w-full" onClick={() => window.print()}>
            <Download className="size-5" /> Save as PDF
          </Button>
        ) : (
          <>
            <Button
              size="lg"
              className="w-full"
              disabled={stale || approve.isPending}
              onClick={() =>
                approve.mutate({ variantId: v.id, jobId }, { onSuccess: () => toast({ text: 'Resume approved — you can save it as a PDF' }) })
              }
            >
              <Check className="size-5" /> {approve.isPending ? 'Approving…' : 'Approve'}
            </Button>
            <p className="text-center text-[13px] text-muted">
              {stale
                ? "An out-of-date resume can't be approved."
                : 'Read every bullet first. Approving removes the watermark and unlocks Save as PDF.'}
            </p>
          </>
        )}
        {approve.isError && <p className="text-center text-sm text-danger-fg">{approve.error.message}</p>}
      </div>

      <BulletSheet bullet={bullet} sources={resume.data.sources} onClose={() => setBullet(null)} />
    </div>
  );
}

// Shows the page at its real width (816px), scaled down to fit narrower screens — like a
// document preview — so the layout is exactly what prints. Printing undoes the scaling
// (`!` = !important, because the scale is an inline style).
function FitToWidth({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; height?: number }>({ scale: 1 });
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return; // jsdom
    const measure = () => {
      const scale = Math.min(1, (outer.current?.clientWidth ?? PAGE_PX) / PAGE_PX);
      setFit({ scale, height: (inner.current?.offsetHeight ?? 0) * scale });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(outer.current!);
    ro.observe(inner.current!);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="overflow-hidden print:h-auto! print:overflow-visible" style={{ height: fit.height }}>
      <div
        ref={inner}
        className="origin-top-left shadow-[0_1px_2px_rgb(0_0_0/0.12),0_8px_24px_rgb(0_0_0/0.14)] print:w-auto! print:transform-none! print:shadow-none"
        style={{ width: PAGE_PX, transform: `scale(${fit.scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

// The evidence behind one bullet, in the user's own words (design pattern board). This is
// the review: does the bullet say more than you did?
function BulletSheet({ bullet, sources, onClose }: { bullet: ResumeBullet | null; sources: JobResume['sources']; onClose: () => void }) {
  return (
    <Sheet
      open={bullet !== null}
      onClose={onClose}
      title="Bullet evidence"
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Link to="/evidence" className={buttonStyles('secondary')}>
            Edit evidence
          </Link>
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      {bullet && (
        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Bullet</p>
          <p className="text-[15px] leading-[21px] text-fg">
            “{bullet.label && `${bullet.label}: `}
            {bullet.text}”
          </p>
          <p className="text-xs text-muted">
            Built from {bullet.evidenceIds.length} verified evidence {bullet.evidenceIds.length === 1 ? 'item' : 'items'} — your words:
          </p>
          <ul className="space-y-2.5">
            {bullet.evidenceIds.map((id) => {
              const s = sources[id];
              return (
                <li key={id} className="space-y-2.5 rounded-[14px] border border-border p-3.5">
                  {s ? (
                    <>
                      <p className="text-[15px] leading-[21px] text-fg">“{s.whatIDid}”</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge>{s.skillName}</Badge>
                        <Badge>{title(s.context)}</Badge>
                        <Badge>{title(s.depth)}</Badge>
                        {s.isVerified ? <Badge tone="accent">Verified</Badge> : <Badge tone="danger">No longer verified</Badge>}
                        <span className="text-xs text-muted tabular-nums">{monthYear(s.lastUsed)}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-danger-fg">An item this bullet used was deleted.</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Sheet>
  );
}
