import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SaveStatus } from '../../components/SaveStatus';
import { useAiUsage, useUpdateAiSettings } from '../../lib/queries';
import { Group } from './ListGroup';

// The monthly AI allowance (read-only: an admin sets it), the daily limit on automatic
// scoring, and the resume-reuse threshold (docs/ai-scoring.md §12.3, docs/resume.md §13.2).
// The two settings save on change and say so; a run of stepper taps is one save, sent once
// they pause (UI audit G13).
const STEP_SAVE_MS = 600;

// Taps not yet sent, and the debounced save behind them.
function useStepper(commit: (next: number, done: () => void) => void) {
  const [pending, setPending] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const step = (current: number, delta: number, min: number, max: number) => {
    const next = Math.min(max, Math.max(min, (pending ?? current) + delta));
    setPending(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (next !== current) commit(next, () => setPending(null));
      else setPending(null);
    }, STEP_SAVE_MS);
  };
  return { pending, step };
}

export function Budget() {
  const usage = useAiUsage();
  const update = useUpdateAiSettings();
  const [overlap, setOverlap] = useState<number | null>(null);
  const dailyStepper = useStepper((v, done) => update.mutate({ maxAnalysesPerDay: v }, { onSettled: done }));
  if (!usage.data) return null;
  const u = usage.data;
  const cap = u.settings.monthlyBudgetUsd;
  const daily = dailyStepper.pending ?? u.settings.maxAnalysesPerDay;
  const pct = Math.round((overlap ?? u.settings.resumeReuseMinOverlap) * 100);
  return (
    <Group label="Budget">
      {/* The monthly allowance is read-only: Shortlist pays for the AI, so only an admin
          changes it (Agents.md §2.1). Finding and tracking jobs never stop when it runs out. */}
      <div className="space-y-2 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-body font-semibold text-fg">Monthly AI allowance</p>
          <p className="text-body text-muted tabular-nums">
            ${u.monthToDateUsd.toFixed(2)} of ${cap.toFixed(2)}
          </p>
        </div>
        <progress
          aria-label="AI allowance used this month"
          max={Math.max(cap, 0.01)}
          value={Math.min(u.monthToDateUsd, cap)}
          className="block h-1.5 w-full appearance-none overflow-hidden rounded-full bg-surface-2 [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-surface-2 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-accent"
        />
        <p className="text-caption text-muted">
          Scoring jobs and tailoring resumes use it. When it runs out they wait until the 1st; finding and tracking jobs
          carry on.
        </p>
      </div>
      {/* The daily limit paces automatic scoring only: a job you retry, paste a description
          for or add yourself is scored at once, within the monthly cap. */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-fg">Daily scoring limit</p>
          <p className="text-footnote text-muted">
            <span className="tabular-nums">{u.analysesLast24h}</span> jobs scored in the last 24 h. Jobs you ask about
            aren't limited.
          </p>
        </div>
        <div className="flex h-11 items-center overflow-hidden rounded-md border border-input-border">
          <button
            type="button"
            aria-label="Lower the daily limit by 5"
            onClick={() => dailyStepper.step(u.settings.maxAnalysesPerDay, -5, 0, 500)}
            className="grid h-full w-11 place-items-center text-fg"
          >
            <Minus className="size-4" />
          </button>
          <output
            aria-label="Daily scoring limit"
            className="grid h-full w-14 place-items-center border-x border-input-border text-control font-semibold text-fg tabular-nums"
          >
            {daily}
          </output>
          <button
            type="button"
            aria-label="Raise the daily limit by 5"
            onClick={() => dailyStepper.step(u.settings.maxAnalysesPerDay, 5, 0, 500)}
            className="grid h-full w-11 place-items-center text-fg"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>
      <div className="space-y-2 px-4 py-3">
        <div className="flex items-baseline justify-between">
          <label htmlFor="reuse" className="text-body font-semibold text-fg">
            Resume reuse threshold
          </label>
          <span className="text-body font-semibold text-accent-fg tabular-nums">{pct}%</span>
        </div>
        <input
          id="reuse"
          type="range"
          min={50}
          max={100}
          step={5}
          value={pct}
          onChange={(e) => setOverlap(Number(e.target.value) / 100)}
          onPointerUp={() => overlap !== null && update.mutate({ resumeReuseMinOverlap: overlap })}
          onKeyUp={() => overlap !== null && update.mutate({ resumeReuseMinOverlap: overlap })}
          className="w-full accent-[var(--accent)]"
        />
        <p className="text-caption text-muted">
          Offer an approved resume instead of tailoring when it matches a job at least this well. Lower saves money;
          higher fits better.
        </p>
      </div>
      {update.isError ? (
        <p className="px-4 pb-3 text-caption text-danger-fg">{update.error.message}</p>
      ) : (
        <SaveStatus {...update} isPending={update.isPending || dailyStepper.pending !== null} className="px-4 pb-3" />
      )}
    </Group>
  );
}
