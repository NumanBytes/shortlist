import { SetAiBudgetSchema } from '@shortlist/shared';
import { Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { Button, Card, EmptyState, INPUT, Skeleton } from '../../components/ui';
import { PageHeader } from '../../layout/AppShell';
import { useAdminUsers, useProfile, useSetUserBudget } from '../../lib/queries';
import type { AdminUser } from '../../lib/types';

const money = (n: number) => `$${n.toFixed(2)}`;

// Accounts and their AI budgets, for an admin of hosted Shortlist (Agents.md §2.1). The
// server's Anthropic key pays for every account, so this is the only place a monthly budget
// is raised or lowered. Anyone else is sent to Jobs (the API answers them 404 anyway).
export function AdminPage() {
  const profile = useProfile();
  const isAdmin = profile.data?.role === 'ADMIN';
  const users = useAdminUsers(isAdmin);
  if (profile.data && !isAdmin) return <Navigate to="/" replace />;
  const total = (users.data ?? []).reduce((sum, u) => sum + u.monthToDateUsd, 0);
  return (
    <main className="mx-auto max-w-2xl space-y-4 pb-6">
      <PageHeader title="Accounts" />
      {!users.data ? (
        <Skeleton className="h-40 w-full" />
      ) : users.data.length === 0 ? (
        <EmptyState icon={<Users className="size-6" />} title="No accounts yet" />
      ) : (
        <>
          <p className="text-footnote text-muted tabular-nums">
            {users.data.length} accounts · {money(total)} of AI this month
          </p>
          <ul className="space-y-2.5">
            {users.data.map((u) => (
              <li key={u.id}>
                <AccountRow user={u} />
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function AccountRow({ user: u }: { user: AdminUser }) {
  const setBudget = useSetUserBudget();
  const [draft, setDraft] = useState(String(u.monthlyBudgetUsd));
  const [error, setError] = useState<string>();
  const id = `budget-${u.id}`;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Number('') is 0 — an emptied field must not silently set a $0 budget.
    const amount = draft.trim() === '' ? Number.NaN : Number(draft.replace('$', ''));
    const parsed = SetAiBudgetSchema.safeParse({ monthlyBudgetUsd: amount });
    if (!parsed.success) {
      setError('Enter a dollar amount from 0 to 1000');
      return;
    }
    setError(undefined);
    setBudget.mutate({ id: u.id, body: parsed.data });
  };
  const message = error ?? setBudget.error?.message;
  return (
    <Card className="space-y-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-body font-semibold text-fg">
          {u.name} {u.role === 'ADMIN' && <span className="text-footnote font-medium text-muted">· admin</span>}
        </p>
        <p className="truncate text-footnote text-muted">
          {u.email}
          {!u.emailVerifiedAt && ' · email not verified'}
        </p>
        <p className="text-footnote text-muted tabular-nums">
          {money(u.monthToDateUsd)} of {money(u.monthlyBudgetUsd)} this month
        </p>
      </div>
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <label htmlFor={id} className="block text-footnote font-medium text-muted">
            Monthly AI budget (USD)
          </label>
          <input
            id={id}
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={error ? true : undefined}
            className={`${INPUT} h-11`}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={setBudget.isPending}>
          {setBudget.isPending ? 'Saving…' : 'Save'}
        </Button>
      </form>
      {message && <p className="text-footnote text-danger-fg">{message}</p>}
    </Card>
  );
}
