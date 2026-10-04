import { MoreHorizontal } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { IconButton, Sheet } from './ui';

export interface MenuAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

// The "···" button in a screen's top bar (design boards 2 and 3): a sheet of actions for
// this item. The sheet closes before the action runs, so a toast it shows is visible.
export function MoreMenu({ title, actions }: { title: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="More actions" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <MoreHorizontal className="size-5" />
      </IconButton>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <p className="pb-2 text-[13px] text-muted">{title}</p>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
          {actions.map((a) => (
            <li key={a.label}>
              <button
                type="button"
                disabled={a.disabled}
                onClick={() => {
                  setOpen(false);
                  a.onSelect();
                }}
                className={`flex min-h-14 w-full items-center gap-3 px-4 text-left text-base font-medium disabled:opacity-45 ${a.danger ? 'text-danger-fg' : 'text-fg'} hover:bg-surface-2`}
              >
                <span className={`grid size-9 shrink-0 place-items-center rounded-[10px] ${a.danger ? 'bg-danger-bg' : 'bg-surface-2 text-muted'}`}>{a.icon}</span>
                {a.label}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
