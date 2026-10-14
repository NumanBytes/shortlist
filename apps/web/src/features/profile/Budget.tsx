import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { useAiUsage, useUpdateAiSettings } from '../../lib/queries';
import { Group } from './ListGroup';

// The monthly AI cap (a stepper; the middle is editable) and the resume-reuse threshold
// (docs/ai-scoring.md §12.3, docs/resume.md §13.2). Both save straight away; the server confirms.
export function Budget() {
  const usage = useAiUsage();
  const update = useUpdateAiSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<number | null>(null);
  if (!usage.data) return null;
  const u = usage.data;
  const cap = u.settings.monthlyBudgetUsd;
  const saveCap = (value: number) => {
    if (Number.isFinite(value) && value >= 0 && value <= 1000 && value !== cap)
      update.mutate({ monthlyBudgetUsd: value });
    setDraft(null);
  };
  const pct = Math.round((overlap ?? u.settings.resumeReuseMinOverlap) * 100);
  return (
    <Group label="Budget">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-fg">Monthly AI cap</p>
          <p className="text-[13px] text-muted tabular-nums">${u.monthToDateUsd.toFixed(2)} used this month</p>
        </div>
        <div className="flex h-11 items-center overflow-hidden rounded-xl border border-input-border">
          <button
            type="button"
            aria-label="Lower the cap by $1"
            onClick={() => saveCap(Math.max(0, cap - 1))}
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
            value={draft ?? `$${cap}`}
            onFocus={() => setDraft(String(cap))}
            onChange={(e) => setDraft(e.target.value)}
            // Number('') is 0 — an emptied field must not silently set a $0 budget.
            onBlur={() => saveCap(draft === null || draft.trim() === '' ? Number.NaN : Number(draft.replace('$', '')))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-full w-16 border-x border-input-border bg-transparent text-center text-base font-semibold text-fg tabular-nums focus:outline-none"
          />
          <button
            type="button"
            aria-label="Raise the cap by $1"
            onClick={() => saveCap(cap + 1)}
            className="grid h-full w-11 place-items-center text-fg"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>
      <div className="space-y-2 px-4 py-3">
        <div className="flex items-baseline justify-between">
          <label htmlFor="reuse" className="text-[15px] font-semibold text-fg">
            Resume reuse threshold
          </label>
          <span className="text-[15px] font-semibold text-accent-fg tabular-nums">{pct}%</span>
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
        <p className="text-xs text-muted">
          Offer an approved resume instead of tailoring when it matches a job at least this well. Lower saves money;
          higher fits better.
        </p>
      </div>
      {update.isError && <p className="px-4 pb-3 text-xs text-danger-fg">{update.error.message}</p>}
    </Group>
  );
}
