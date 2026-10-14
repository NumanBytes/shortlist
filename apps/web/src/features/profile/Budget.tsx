import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SaveStatus } from '../../components/SaveStatus';
import { useAiUsage, useUpdateAiSettings } from '../../lib/queries';
import { Group } from './ListGroup';

// The monthly AI cap (a stepper; the middle is editable), the daily limit on automatic
// scoring, and the resume-reuse threshold (docs/ai-scoring.md §12.3, docs/resume.md §13.2).
// All save on change and say so; a run of stepper taps is one save, sent once they pause
// (UI audit G13).
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
  const [draft, setDraft] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<number | null>(null);
  const capStepper = useStepper((v, done) => update.mutate({ monthlyBudgetUsd: v }, { onSettled: done }));
  const dailyStepper = useStepper((v, done) => update.mutate({ maxAnalysesPerDay: v }, { onSettled: done }));
  const stepped = capStepper.pending;
  if (!usage.data) return null;
  const u = usage.data;
  const cap = u.settings.monthlyBudgetUsd;
  const saveCap = (value: number) => {
    if (Number.isFinite(value) && value >= 0 && value <= 1000 && value !== cap)
      update.mutate({ monthlyBudgetUsd: value });
    setDraft(null);
  };
  const step = (delta: number) => capStepper.step(cap, delta, 0, 1000);
  const daily = dailyStepper.pending ?? u.settings.maxAnalysesPerDay;
  const pct = Math.round((overlap ?? u.settings.resumeReuseMinOverlap) * 100);
  return (
    <Group label="Budget">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-fg">Monthly AI cap</p>
          <p className="text-footnote text-muted tabular-nums">${u.monthToDateUsd.toFixed(2)} used this month</p>
        </div>
        <div className="flex h-11 items-center overflow-hidden rounded-md border border-input-border">
          <button
            type="button"
            aria-label="Lower the cap by $1"
            onClick={() => step(-1)}
            className="grid h-full w-11 place-items-center text-fg"
          >
            <Minus className="size-4" />
          </button>
          <label className="sr-only" htmlFor="budget">
            Monthly budget in dollars
          </label>
          <input
            id="budget"
            inputMode="decimal"
            value={draft ?? `$${stepped ?? cap}`}
            onFocus={() => setDraft(String(cap))}
            onChange={(e) => setDraft(e.target.value)}
            // Number('') is 0 — an emptied field must not silently set a $0 budget.
            onBlur={() => saveCap(draft === null || draft.trim() === '' ? Number.NaN : Number(draft.replace('$', '')))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-full w-16 border-x border-input-border bg-transparent text-center text-control font-semibold text-fg tabular-nums focus:outline-none"
          />
          <button
            type="button"
            aria-label="Raise the cap by $1"
            onClick={() => step(1)}
            className="grid h-full w-11 place-items-center text-fg"
          >
            <Plus className="size-4" />
          </button>
        </div>
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
        <SaveStatus
          {...update}
          isPending={update.isPending || stepped !== null || dailyStepper.pending !== null}
          className="px-4 pb-3"
        />
      )}
    </Group>
  );
}
