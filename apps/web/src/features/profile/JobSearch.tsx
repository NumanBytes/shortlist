import { FileUp, SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { Sheet } from '../../components/ui';
import { usePreferences } from '../../lib/queries';
import { Group, Row } from './ListGroup';
import { ResumeImport } from './ResumeImport';
import { SearchSettingsForm } from './SearchSettingsForm';

// Which sheet is open lives in the URL (`?open=import`), so Evidence's empty state can link
// straight to the import (UI audit G12).
function useOpenSheet(name: 'search' | 'import') {
  const [params, setParams] = useSearchParams();
  const set = (on: boolean) =>
    setParams(
      (p) => {
        if (on) p.set('open', name);
        else p.delete('open');
        return p;
      },
      { replace: true },
    );
  return [params.get('open') === name, set] as const;
}

// What the user is looking for and adding career data from a resume — the two onboarding
// steps, kept reachable after it (docs/discovery.md §9.13, docs/career-data.md §7.6). The
// search is a setting; the import adds to Career.
export function JobSearch() {
  const prefs = usePreferences();
  const [open, setOpen] = useOpenSheet('search');
  const p = prefs.data?.preferences;
  return (
    <Group label="Job search">
      <Row
        icon={<SlidersHorizontal className="size-[18px]" />}
        title="What I'm looking for"
        sub={p ? [p.titleInclude.slice(0, 4).join(', '), p.onsiteLocations[0]].filter(Boolean).join(' · ') : undefined}
        onClick={() => setOpen(true)}
      />
      <Sheet open={open} onClose={() => setOpen(false)} title="What I'm looking for">
        {open && p && <SearchSettingsForm initial={p} onDone={() => setOpen(false)} />}
      </Sheet>
    </Group>
  );
}

export function ImportFromResume() {
  const [open, setOpen] = useOpenSheet('import');
  return (
    <Group label="Add from a resume">
      <Row
        icon={<FileUp className="size-[18px]" />}
        title="Import from my resume"
        sub="Adds roles, projects and skills — unverified"
        onClick={() => setOpen(true)}
      />
      <Sheet open={open} onClose={() => setOpen(false)} title="Import from my resume">
        {open && <ResumeImport />}
      </Sheet>
    </Group>
  );
}
