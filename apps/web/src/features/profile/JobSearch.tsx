import { FileUp, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../../components/ui';
import { usePreferences } from '../../lib/queries';
import { Group, Row } from './ListGroup';
import { ResumeImport } from './ResumeImport';
import { SearchSettingsForm } from './SearchSettingsForm';

// What the user is looking for, and adding career data from a resume — the two onboarding
// steps, kept reachable after it (docs/discovery.md §9.13, docs/career-data.md §7.6).
export function JobSearch() {
  const prefs = usePreferences();
  const [open, setOpen] = useState<'search' | 'import' | null>(null);
  const p = prefs.data?.preferences;
  return (
    <Group label="Job search">
      <Row
        icon={<SlidersHorizontal className="size-[18px]" />}
        title="What I'm looking for"
        sub={p ? [p.titleInclude.slice(0, 4).join(', '), p.onsiteLocations[0]].filter(Boolean).join(' · ') : undefined}
        onClick={() => setOpen('search')}
      />
      <Row
        icon={<FileUp className="size-[18px]" />}
        title="Import from my resume"
        sub="Adds roles, projects and skills — unverified"
        onClick={() => setOpen('import')}
      />
      <Sheet open={open === 'search'} onClose={() => setOpen(null)} title="What I'm looking for">
        {open === 'search' && p && <SearchSettingsForm initial={p} onDone={() => setOpen(null)} />}
      </Sheet>
      <Sheet open={open === 'import'} onClose={() => setOpen(null)} title="Import from my resume">
        {open === 'import' && <ResumeImport />}
      </Sheet>
    </Group>
  );
}
