import type { PaperSizeValue } from '@shortlist/shared';
import { useMemo } from 'react';
import { INPUT, Segmented } from '../../components/ui';
import { SaveStatus } from '../../components/SaveStatus';
import { useProfile, useUpdateProfile } from '../../lib/queries';
import { Group } from './ListGroup';

// The zones this browser knows, with the user's own kept even if the list lacks it.
function zones(current: string): string[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf('timeZone');
  } catch {
    // Older browsers: only the current zone is offered.
  }
  return all.includes(current) ? all : [current, ...all];
}

// The user's clock — the morning digest and quiet hours follow it — and the paper their
// resume prints on (Agents.md §2.1). Both start from the browser at sign-up and save on change.
export function ClockAndPaper() {
  const profile = useProfile();
  const update = useUpdateProfile();
  const timeZone = profile.data?.timeZone ?? 'UTC';
  const options = useMemo(() => zones(timeZone), [timeZone]);
  if (!profile.data) return null;
  return (
    <Group label="Time and paper">
      <div className="space-y-2 px-4 py-3">
        <label htmlFor="time-zone" className="block text-body font-semibold text-fg">
          Time zone
        </label>
        <select
          id="time-zone"
          value={timeZone}
          onChange={(e) => update.mutate({ timeZone: e.target.value })}
          className={`${INPUT} h-11`}
        >
          {options.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        <p className="text-caption text-muted">The morning summary and quiet hours follow this clock.</p>
      </div>
      <div className="space-y-2 px-4 py-3">
        <p className="text-body font-semibold text-fg">Resume paper</p>
        <Segmented<PaperSizeValue>
          label="Resume paper size"
          value={profile.data.paperSize}
          onChange={(paperSize) => update.mutate({ paperSize })}
          options={[
            { value: 'A4', label: 'A4' },
            { value: 'LETTER', label: 'US Letter' },
          ]}
        />
      </div>
      {update.isError ? (
        <p className="px-4 pb-3 text-caption text-danger-fg">{update.error.message}</p>
      ) : (
        <SaveStatus {...update} className="px-4 pb-3" />
      )}
    </Group>
  );
}
