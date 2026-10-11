import { Briefcase, FolderKanban, GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { ProjectForm, RoleForm } from './CareerForms';
import { Sheet, Skeleton } from '../../components/ui';
import { useEducation, useProjects, useWorkExperiences } from '../../lib/queries';
import type { Education, Project, WorkExperience } from '../../lib/types';
import { EducationForm } from './EducationForm';
import { AddRow, Group, Row } from './ListGroup';

const year = (iso: string | null) => (iso ? new Date(iso).getUTCFullYear() : null);

// Roles and projects: tap one to edit it, or add one. Changing what one claims (or
// deleting it) un-verifies its linked evidence — the sheets say so (Agents.md §6.3).
export function Roles() {
  const roles = useWorkExperiences();
  const [editing, setEditing] = useState<WorkExperience | 'new' | null>(null);
  return (
    <Group label="Experience">
      {(roles.data ?? []).map((r) => (
        <Row
          key={r.id}
          icon={<Briefcase className="size-[18px]" />}
          title={r.title}
          sub={`${r.company} · ${year(r.startDate)} – ${r.isCurrent || !r.endDate ? 'Present' : year(r.endDate)}`}
          onClick={() => setEditing(r)}
        />
      ))}
      <AddRow onClick={() => setEditing('new')}>Add role</AddRow>
      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add role' : 'Edit role'}
      >
        {editing && <RoleForm role={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </Group>
  );
}

export function Projects() {
  const projects = useProjects();
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  return (
    <Group label="Projects">
      {(projects.data ?? []).map((p) => (
        <Row
          key={p.id}
          icon={<FolderKanban className="size-[18px]" />}
          title={p.name}
          sub={p.description ?? undefined}
          onClick={() => setEditing(p)}
        />
      ))}
      <AddRow onClick={() => setEditing('new')}>Add project</AddRow>
      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add project' : 'Edit project'}
      >
        {editing && <ProjectForm project={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </Group>
  );
}

export function EducationList() {
  const education = useEducation();
  const [editing, setEditing] = useState<Education | 'new' | null>(null);
  return (
    <Group label="Education">
      {education.isPending && <Skeleton className="m-3 h-12" />}
      {(education.data ?? []).map((e) => (
        <Row
          key={e.id}
          icon={<GraduationCap className="size-[18px]" />}
          title={e.degree}
          sub={[e.institution, e.startYear || e.endYear ? `${e.startYear ?? '?'} – ${e.endYear ?? 'present'}` : null]
            .filter(Boolean)
            .join(' · ')}
          onClick={() => setEditing(e)}
        />
      ))}
      <AddRow onClick={() => setEditing('new')}>Add education</AddRow>
      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add education' : 'Edit education'}
      >
        {editing && <EducationForm initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </Group>
  );
}
