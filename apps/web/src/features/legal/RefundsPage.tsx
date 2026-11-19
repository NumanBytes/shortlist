import { ContactLink, H2, List, PolicyPage } from './PolicyLayout';

// Refund policy (docs/security.md §8.9). Paddle requires a change-of-mind window of 14–90 days,
// requests made through Paddle, and no "all sales are final" wording. The window is
// REFUND_WINDOW_DAYS in @shortlist/shared, served by GET /legal.
export function RefundsPage() {
  return (
    <PolicyPage title="Refund policy" updated="19 November 2026">
      {(legal, operator) => (
        <>
          <p>
            If Shortlist isn&apos;t right for you, you can ask for a full refund within{' '}
            <b>{legal.refundWindowDays} days</b> of a payment, for any reason. That applies to your first payment and to
            each monthly renewal.
          </p>

          <H2>How to ask</H2>
          <List>
            <li>
              Payments are handled by Paddle, our merchant of record, so refunds are too. Find the receipt email from
              Paddle for the payment, or go to{' '}
              <a className="font-semibold text-accent-fg underline" href="https://paddle.net" rel="noopener">
                paddle.net
              </a>{' '}
              and look it up with your email address, then choose to request a refund.
            </li>
            <li>
              You can also write to <ContactLink operator={operator} /> and we&apos;ll arrange it with Paddle.
            </li>
            <li>The money goes back to how you paid. Your bank may take a few days to show it.</li>
          </List>

          <H2>Your subscription</H2>
          <p>
            A refund doesn&apos;t cancel your subscription by itself. If you don&apos;t want to be charged again, also
            cancel it in Profile → Manage billing. Your information, jobs and resumes stay either way.
          </p>

          <H2>After {legal.refundWindowDays} days</H2>
          <p>
            You can still cancel at any time from Profile → Manage billing, and you won&apos;t be charged again. You
            keep the plan until the end of the month you paid for. If something went wrong on our side, such as a double
            charge or Shortlist not working, write to us whenever it happens; this policy doesn&apos;t limit refunds the
            law gives you.
          </p>
        </>
      )}
    </PolicyPage>
  );
}
