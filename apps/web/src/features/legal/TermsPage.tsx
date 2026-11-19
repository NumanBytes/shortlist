import { Link } from 'react-router';
import { ContactLink, H2, List, PolicyPage, nameOf } from './PolicyLayout';

// Terms of service (docs/security.md §8.9). Paddle's review needs: the seller named, Paddle as
// reseller and merchant of record, acceptable use, IP, no warranty of uptime, payment terms,
// suspension, contact. The AI-output and truthfulness parts are Shortlist's own (Agents.md §1.2).
export function TermsPage() {
  return (
    <PolicyPage title="Terms of service" updated="19 November 2026">
      {(legal, operator) => (
        <>
          <p>
            These terms are an agreement between you and {nameOf(operator)} (&ldquo;we&rdquo;), who runs Shortlist. By
            creating an account or using Shortlist you agree to them. If you don&apos;t agree, don&apos;t use Shortlist.
          </p>

          <H2>What Shortlist does</H2>
          <p>
            Shortlist finds job postings, scores how well they fit the skills you&apos;ve confirmed, and drafts a resume
            for a job when you ask. It prepares; you decide. Shortlist never applies to a job, sends a message or fills
            in a form for you.
          </p>

          <H2>Your account</H2>
          <List>
            <li>You must be at least 16 years old.</li>
            <li>Give a real email address, keep your password to yourself, and tell us if your account is misused.</li>
            <li>One person per account. You&apos;re responsible for what happens in yours.</li>
            <li>
              You can download your data or delete your account at any time from your Profile (see the{' '}
              <Link className="font-semibold text-accent-fg underline" to="/privacy">
                privacy policy
              </Link>
              ).
            </li>
          </List>

          <H2>Your career information and AI output</H2>
          <List>
            <li>
              What you enter about your work, projects and skills must be true. Shortlist only uses skills you mark as
              verified, but it can&apos;t check them against the real world: you can.
            </li>
            <li>
              Scores, summaries and tailored resumes are written with the help of AI models. They can be wrong. Read
              every resume before you use it; you are responsible for what you send to an employer.
            </li>
            <li>
              Job postings come from public job boards, company career pages and the job alerts you choose to share. We
              don&apos;t write them and can&apos;t promise they&apos;re accurate, current or genuine.
            </li>
            <li>
              Your content stays yours. You give us permission to store and process it only to run Shortlist for you.
            </li>
          </List>

          <H2>Fair use</H2>
          <p>Don&apos;t use Shortlist to:</p>
          <List>
            <li>break the law, or anyone else&apos;s rights, including copyright;</li>
            <li>commit fraud, send spam, or make applications in someone else&apos;s name;</li>
            <li>
              attack, probe, overload or scrape Shortlist, get around its limits, or reach accounts or data that
              aren&apos;t yours;
            </li>
            <li>resell or give others access to your account.</li>
          </List>

          <H2>Plans and payment</H2>
          <p>
            Shortlist has a free plan and paid monthly plans, described on the{' '}
            <Link className="font-semibold text-accent-fg underline" to="/pricing">
              pricing page
            </Link>
            .
            {legal.payments && (
              <>
                {' '}
                Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record
                for all our orders: Paddle takes the payment, handles taxes and invoices, and provides customer service
                for billing. Paddle&apos;s{' '}
                <a
                  className="font-semibold text-accent-fg underline"
                  href="https://www.paddle.com/legal/buyer-terms"
                  rel="noopener"
                >
                  buyer terms
                </a>{' '}
                apply to your purchase.
              </>
            )}
          </p>
          <List>
            <li>
              Paid plans renew every month until you cancel. You can cancel at any time from Profile → Manage billing;
              you keep the plan until the end of the month you paid for.
            </li>
            <li>Prices are in US dollars. Sales tax or VAT may be added at checkout depending on where you live.</li>
            <li>
              Refunds are covered by the{' '}
              <Link className="font-semibold text-accent-fg underline" to="/refunds">
                refund policy
              </Link>{' '}
              ({legal.refundWindowDays} days).
            </li>
            <li>
              We may change prices or plan limits. A price change for your plan takes effect from your next renewal
              after we tell you, and you can cancel before then.
            </li>
          </List>

          <H2>Shortlist itself</H2>
          <p>
            Shortlist&apos;s software, design and name belong to us. These terms don&apos;t give you any rights to them
            beyond using the service.
          </p>
          <p>
            We work to keep Shortlist running and your data safe, but we provide it &ldquo;as is&rdquo;: we can&apos;t
            promise it will always be available, error-free, or that it will find you a job. To the extent the law
            allows, we aren&apos;t liable for indirect losses, lost opportunities or lost income, and our total
            liability to you is limited to what you paid us in the 12 months before the claim. Nothing here limits
            rights you have that the law says can&apos;t be limited.
          </p>

          <H2>Suspension and ending</H2>
          <p>
            We may suspend or close an account that seriously or repeatedly breaks these terms, doesn&apos;t pay, or
            puts Shortlist or other people at risk. Where we can, we&apos;ll tell you first and give you a chance to
            download your data. You can stop using Shortlist and delete your account whenever you like.
          </p>

          <H2>Changes</H2>
          <p>
            We may update these terms. If a change matters, we&apos;ll tell you in the app or by email before it takes
            effect. Using Shortlist after that means you accept the new terms.
          </p>

          <H2>Law and contact</H2>
          <p>
            These terms are governed by the laws of {operator?.jurisdiction ?? '[jurisdiction not set]'}, without taking
            away any protection the law of your own country gives you as a consumer.
          </p>
          <p>
            Questions about these terms: <ContactLink operator={operator} />
            {operator && <>, or write to {operator.address}</>}.
          </p>
        </>
      )}
    </PolicyPage>
  );
}
