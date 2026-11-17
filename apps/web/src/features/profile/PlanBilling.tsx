import { PLANS, type PaidPlan } from '@shortlist/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { Button, Sheet } from '../../components/ui';
import { openCheckout } from '../../lib/paddle';
import { jobKeys, useBilling, useBillingPortal, useChangePlan, useStartCheckout } from '../../lib/queries';
import type { BillingInfo } from '../../lib/types';

const PAID: PaidPlan[] = ['STARTER', 'PRO'];
const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const offer = (p: PaidPlan) =>
  `$${PLANS[p].priceUsdPerMonth}/month · ${PLANS[p].scoredJobs.toLocaleString()} jobs scored, ${PLANS[p].tailoredResumes} tailored resumes${PLANS[p].runNow ? ', find new jobs any time' : ''}`;
const WATCH_MS = 2 * 60_000;

function statusLine(sub: NonNullable<BillingInfo['subscription']>): string {
  const label = PLANS[sub.plan].label;
  if (sub.status === 'PAST_DUE') return `Your last payment didn't go through. Update your card to keep ${label}.`;
  if (sub.status === 'PAUSED') return 'Your subscription is paused.';
  if (sub.cancelsAt) return `Cancels on ${day(sub.cancelsAt)}. You keep ${label} until then.`;
  return sub.currentPeriodEndsAt ? `Renews on ${day(sub.currentPeriodEndsAt)}.` : `${label}, paid monthly.`;
}

// Buying and managing a plan (docs/billing.md §20.4). Paddle takes the payment in its own
// checkout; the plan changes when Paddle's webhook reaches the server, so after paying this
// polls until it shows. Hidden on servers without payments.
export function PlanBilling() {
  // The plan Paddle's webhook should bring (after paying or switching); null when not waiting.
  // Polling stops once it shows, or after two minutes — the plan still arrives whenever the
  // webhook does.
  const [expecting, setExpecting] = useState<PaidPlan | null>(null);
  useEffect(() => {
    if (!expecting) return;
    const timer = setTimeout(() => setExpecting(null), WATCH_MS);
    return () => clearTimeout(timer);
  }, [expecting]);
  const billing = useBilling(expecting);
  const checkout = useStartCheckout();
  const change = useChangePlan();
  const portal = useBillingPortal();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [switchTo, setSwitchTo] = useState<PaidPlan | null>(null);
  const [opening, setOpening] = useState(false);

  const b = billing.data;
  const sub = b?.subscription && b.subscription.status !== 'CANCELED' ? b.subscription : null;
  const landed = expecting !== null && sub?.plan === expecting;
  const waiting = expecting !== null && !landed;
  // The webhook landed: refresh the plan's limits and say so.
  useEffect(() => {
    if (!landed) return;
    void queryClient.invalidateQueries({ queryKey: jobKeys.aiUsage });
    toast({ text: 'Your plan is active' });
  }, [landed, queryClient, toast]);

  if (!b?.enabled || !b.client) return null;
  const client = b.client;

  const buy = (plan: PaidPlan) => {
    setOpening(true);
    checkout.mutate(plan, {
      onSuccess: ({ checkoutId }) =>
        openCheckout(client, checkoutId, () => {
          setExpecting(plan);
          toast({ text: 'Payment received — your plan updates in a moment' });
        })
          .catch((err: Error) => toast({ text: err.message, tone: 'error' }))
          .finally(() => setOpening(false)),
      onError: (err) => {
        setOpening(false);
        toast({ text: err.message, tone: 'error' });
      },
    });
  };
  const manage = () =>
    portal.mutate(undefined, {
      // Paddle's portal: cancel, change card, invoices. Its links are short-lived, so they're
      // fetched on tap and never stored.
      onSuccess: (links) => window.location.assign(links.overview),
      onError: (err) => toast({ text: err.message, tone: 'error' }),
    });

  if (sub) {
    const other = sub.plan === 'PRO' ? 'STARTER' : 'PRO';
    return (
      <div className="space-y-3 border-t border-border px-4 py-3">
        <p className={`text-footnote ${sub.status === 'PAST_DUE' ? 'text-danger-fg' : 'text-muted'}`}>
          {statusLine(sub)}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {sub.status !== 'PAST_DUE' && !sub.cancelsAt && (
            <Button variant="secondary" onClick={() => setSwitchTo(other)} disabled={change.isPending}>
              Switch to {PLANS[other].label}
            </Button>
          )}
          <Button variant="secondary" onClick={manage} disabled={portal.isPending}>
            {sub.status === 'PAST_DUE' ? 'Update card' : 'Manage billing'}
          </Button>
        </div>
        <Sheet
          open={switchTo !== null}
          onClose={() => setSwitchTo(null)}
          title={`Switch to ${switchTo ? PLANS[switchTo].label : ''}?`}
        >
          {switchTo && (
            <div className="space-y-3">
              <p className="text-body text-fg">{offer(switchTo)}.</p>
              <p className="text-footnote text-muted">
                {switchTo === 'PRO'
                  ? 'You pay the difference for the rest of this month today.'
                  : 'The unused part of this month is credited to your next payments.'}{' '}
                Your plan changes as soon as Paddle confirms.
              </p>
              <Button
                size="lg"
                className="w-full"
                disabled={change.isPending}
                onClick={() =>
                  change.mutate(switchTo, {
                    onSuccess: () => {
                      setExpecting(switchTo);
                      setSwitchTo(null);
                      toast({ text: `Switching to ${PLANS[switchTo].label}…` });
                    },
                    onError: (err) => toast({ text: err.message, tone: 'error' }),
                  })
                }
              >
                Switch to {PLANS[switchTo].label}
              </Button>
            </div>
          )}
        </Sheet>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-border px-4 py-3">
      <p className="text-footnote text-muted">
        {waiting ? 'Waiting for the payment to be confirmed…' : 'Upgrade any time. Cancel whenever you like.'}
      </p>
      {PAID.map((p) => (
        <div key={p} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold text-fg">{PLANS[p].label}</p>
            <p className="text-caption text-muted">{offer(p)}</p>
          </div>
          <Button
            size="sm"
            variant="tinted"
            onClick={() => buy(p)}
            disabled={opening || waiting}
            aria-label={`Choose ${PLANS[p].label}`}
          >
            Choose
          </Button>
        </div>
      ))}
      <p className="text-caption text-muted">Payments are handled by Paddle, which also sends your receipts.</p>
    </div>
  );
}
