import { DeleteAccountSchema, PLANS } from '@shortlist/shared';
import { Download, FileText, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useToast } from '../../components/Toast';
import { Button, Sheet, TextField } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useBilling, useDeleteAccount, useExportAccount } from '../../lib/queries';
import { useAuth } from '../auth/AuthProvider';
import { Group, Row } from './ListGroup';

// The user's data rights (docs/security.md §8.8): download everything, or delete everything.
// Both work without asking anyone.
export function YourData() {
  const exportData = useExportAccount();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  return (
    <Group label="Your data">
      <Row
        icon={<Download className="size-[18px]" />}
        title="Download my data"
        sub={exportData.isPending ? 'Preparing your file…' : 'Everything in your account, as a JSON file'}
        onClick={() => {
          if (exportData.isPending) return;
          exportData.mutate(undefined, {
            onError: (err) => toast({ text: err.message, tone: 'error' }),
          });
        }}
      />
      <Link to="/privacy" className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted">
          <FileText className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-fg">Privacy and terms</span>
          <span className="block truncate text-footnote text-muted">What we keep, who sees it, your rights</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => setDeleting(true)}
        className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-body font-semibold text-danger-fg"
      >
        <span className="grid size-9 place-items-center rounded-sm bg-danger-bg">
          <Trash2 className="size-[18px]" />
        </span>
        Delete account
      </button>
      <Sheet
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete your account?"
        icon={<Trash2 className="size-5" />}
      >
        <DeleteAccountForm />
      </Sheet>
    </Group>
  );
}

function DeleteAccountForm() {
  const { logout } = useAuth();
  const remove = useDeleteAccount();
  const billing = useBilling();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const sub = billing.data?.subscription;
  const paying = sub && sub.status !== 'CANCELED' ? PLANS[sub.plan].label : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = DeleteAccountSchema.safeParse({ password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    remove.mutate(parsed.data, {
      onSuccess: () => {
        toast({ text: 'Your account was deleted' });
        void logout();
      },
      onError: (err) => {
        const field = err instanceof ApiError ? err.fieldErrors.password : undefined;
        setError(field ?? err.message);
      },
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-body text-fg">
        This removes your profile, career information, evidence, jobs, resumes and settings for good. It can&apos;t be
        undone. Download your data first if you want a copy.
      </p>
      {paying && (
        <p className="rounded-md bg-danger-bg p-3 text-footnote text-danger-fg">
          Your {paying} subscription is cancelled now, and the rest of this month is not refunded automatically. For a
          refund within the refund window, see the{' '}
          <Link to="/refunds" className="font-semibold underline">
            refund policy
          </Link>
          .
        </p>
      )}
      <TextField
        id="delete-password"
        label="Your password, to confirm"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={error}
      />
      <Button type="submit" size="lg" variant="danger" className="w-full" disabled={remove.isPending}>
        {remove.isPending ? 'Deleting…' : 'Delete my account'}
      </Button>
    </form>
  );
}
