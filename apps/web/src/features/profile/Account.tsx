import { ChevronRight, LogOut, Mail } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { useGmail } from '../../lib/queries';
import { Group } from './ListGroup';

// Gmail connection (managed on Sources) and sign-out.
export function Account() {
  const { logout } = useAuth();
  const gmail = useGmail();
  const c = gmail.data?.connection;
  return (
    <Group label="Account">
      <Link to="/sources" className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-muted">
          <Mail className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-fg">Gmail</span>
          <span className="block truncate text-[13px] text-muted">
            {c ? `Connected · label “${c.labelName}”` : 'Not connected'}
          </span>
        </span>
        <ChevronRight className="size-4 text-muted" />
      </Link>
      <button
        type="button"
        onClick={() => void logout()}
        className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-[15px] font-semibold text-danger-fg"
      >
        <span className="grid size-9 place-items-center rounded-[10px] bg-danger-bg">
          <LogOut className="size-[18px]" />
        </span>
        Sign out
      </button>
    </Group>
  );
}
