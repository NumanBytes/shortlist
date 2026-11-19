import { PLANS, type PlanName } from '@shortlist/shared';
import { Check } from 'lucide-react';
import { Link } from 'react-router';
import { buttonStyles } from '../../components/ui';
import { H2, PolicyPage } from './PolicyLayout';

// Public pricing (docs/security.md §8.9): Paddle's reviewers and anyone deciding whether to sign
// up must see what a plan costs and gives before an account exists. Built from PLANS, the one
// definition of the plans (docs/ai-scoring.md §12.5), so it can't drift from the limits enforced.
const ORDER: PlanName[] = ['FREE', 'STARTER', 'PRO'];

function features(name: PlanName): string[] {
  const p = PLANS[name];
  const once = p.period === 'trial';
  return [
    `${p.scoredJobs.toLocaleString()} jobs scored ${once ? 'to start' : 'a month'}`,
    `${p.tailoredResumes} tailored resumes ${once ? 'to start' : 'a month'}`,
    p.discoveryEveryDays === 1 ? 'New jobs found every day' : `New jobs found every ${p.discoveryEveryDays} days`,
    ...(p.runNow ? ['Find new jobs any time'] : []),
  ];
}

export function PricingPage() {
  return (
    <PolicyPage title="Pricing" updated="19 November 2026">
      {(legal) => (
        <>
          <p>
            Finding and tracking jobs is free. The AI work — scoring how well a job fits and tailoring a resume — comes
            in plans.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {ORDER.map((name) => {
              const p = PLANS[name];
              return (
                <section key={name} className="rounded-lg border border-border bg-surface p-4" aria-label={p.label}>
                  <h2 className="text-headline font-semibold text-fg">{p.label}</h2>
                  <p className="mt-1">
                    <span className="text-title font-bold text-fg">${p.priceUsdPerMonth}</span>
                    <span className="text-footnote text-muted">{p.priceUsdPerMonth ? ' / month' : ' forever'}</span>
                  </p>
                  <ul className="mt-3 space-y-2 text-footnote text-fg">
                    {features(name).map((f) => (
                      <li key={f} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-accent-fg" aria-hidden="true" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          <Link to="/register" className={`${buttonStyles('primary', 'lg')} w-full sm:w-auto`}>
            Start free
          </Link>

          <H2>Good to know</H2>
          <ul className="list-disc space-y-2 pl-5">
            <li>Prices are in US dollars. Sales tax or VAT may be added at checkout depending on where you live.</li>
            <li>
              Paid plans renew monthly. Cancel any time; you keep the plan until the end of the month you paid for.
            </li>
            <li>
              Full refund within {legal.refundWindowDays} days of a payment —{' '}
              <Link className="font-semibold text-accent-fg underline" to="/refunds">
                refund policy
              </Link>
              .
            </li>
            <li>Upgrade or switch plans from your Profile once you&apos;ve signed up.</li>
            {legal.payments && <li>Payments are handled by Paddle, our merchant of record.</li>}
          </ul>
        </>
      )}
    </PolicyPage>
  );
}
