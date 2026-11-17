import { ChevronRight, LogOut, Mail, Users } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { useGmail, useProfile } from '../../lib/queries';
import { Group } from './ListGroup';

// Gmail connection (managed on Sources), the admin's account list, and sign-out.
export function Account() {
  const { logout } = useAuth();
  const gmail = useGmail();
  const c = gmail.data?.connection;
  const isAdmin = useProfile().data?.role === 'ADMIN';
  return (
    <Group label="Account">
      {isAdmin && (
        <Link to="/admin" className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted">
            <Users className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold text-fg">Accounts</span>
            <span className="block truncate text-footnote text-muted">Everyone’s AI spend and budgets</span>
          </span>
          <ChevronRight className="size-4 text-muted" />
        </Link>
      )}
      <Link to="/sources" className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted">
          <Mail className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-fg">Gmail</span>
          <span className="block truncate text-footnote text-muted">
            {c ? `Connected · label “${c.labelName}”` : 'Not connected'}
          </span>
        </span>
        <ChevronRight className="size-4 text-muted" />
      </Link>
      <button
        type="button"
        onClick={() => void logout()}
        className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-body font-semibold text-danger-fg"
      >
        <span className="grid size-9 place-items-center rounded-sm bg-danger-bg">
          <LogOut className="size-[18px]" />
        </span>
        Sign out
      </button>
    </Group>
  );
}
