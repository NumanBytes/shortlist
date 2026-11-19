import { ContactLink, H2, List, PolicyPage, nameOf } from './PolicyLayout';

// Privacy notice (docs/security.md §8.9). Every statement here must match what the code does
// — what is stored, what is sent where, how long it stays. Change this page in the same change
// as the code it describes.
export function PrivacyPage() {
  return (
    <PolicyPage title="Privacy policy" updated="19 November 2026">
      {(legal, operator) => (
        <>
          <p>
            {nameOf(operator)} runs Shortlist and is responsible for your personal data in it (the
            &ldquo;controller&rdquo;). This page says what we collect, why, who else sees it, how long we keep it, and
            what you can do about it.
          </p>
          <p>
            Contact for anything about your data: <ContactLink operator={operator} />
            {operator && <>, {operator.address}</>}.
          </p>

          <H2>What we collect, and why</H2>
          <List>
            <li>
              <b>Your account:</b> email address, name, password (stored only as a one-way hash), time zone, paper size
              and plan. To sign you in, run the service and send account emails. Basis: our contract with you.
            </li>
            <li>
              <b>Your career information:</b> work history, projects, skills, evidence, education, the contact details
              you put on your resume (such as phone, location, LinkedIn and GitHub) and the claims you never want made.
              If you import a resume, its text is read in your browser, sent to us, and deleted once the import ends. To
              score jobs and draft resumes for you. Basis: contract.
            </li>
            <li>
              <b>Jobs:</b> the sources you follow, the job postings found for you, their scores, the resumes drafted,
              and what you mark as applied. Basis: contract.
            </li>
            {legal.gmail && (
              <li>
                <b>Gmail, only if you connect it:</b> read-only access to the one label you choose. We store the sender,
                subject and date of each job-alert email and the jobs found in it, never the email&apos;s body. The
                access token is stored encrypted. You can disconnect at any time. Basis: your consent.
              </li>
            )}
            <li>
              <b>Notifications, only if you turn them on:</b> your browser&apos;s push address and keys, and its name
              (such as &ldquo;Chrome on Android&rdquo;) so you can tell devices apart. Basis: consent.
            </li>
            {legal.payments && (
              <li>
                <b>Payments:</b> Paddle takes your card or other payment details; we never see them. We receive your
                plan, subscription status and Paddle&apos;s customer and subscription IDs. Basis: contract and our legal
                duty to keep financial records.
              </li>
            )}
            <li>
              <b>Usage and security:</b> a record of each AI request (its purpose, size and cost) to enforce plan limits
              and budgets, and your IP address, held briefly to limit sign-in attempts. Basis: our legitimate interest
              in running Shortlist safely and within its costs.
            </li>
          </List>
          <p>We don&apos;t sell your data, show you ads, or use it to train AI models.</p>

          <H2>Who else processes it</H2>
          <List>
            <li>
              <b>Anthropic</b> runs the AI models. To score a job, draft a resume, import a resume or read a job-alert
              email, we send it the job posting and the parts of your career information (or the email) that the task
              needs. Under Anthropic&apos;s commercial terms, what we send isn&apos;t used to train its models.
            </li>
            {legal.payments && (
              <li>
                <b>Paddle</b> is the merchant of record for payments: it receives what you enter at checkout and the
                account ID that links your subscription to you. Its own{' '}
                <a
                  className="font-semibold text-accent-fg underline"
                  href="https://www.paddle.com/legal/privacy"
                  rel="noopener"
                >
                  privacy notice
                </a>{' '}
                covers what it does with it.
              </li>
            )}
            {legal.gmail && (
              <li>
                <b>Google</b>, if you connect Gmail: we read your chosen label through Google&apos;s API.
              </li>
            )}
            {legal.email && (
              <li>
                An <b>email delivery provider</b>, to send verification and password-reset emails.
              </li>
            )}
            <li>
              <b>Browser push services</b> (run by your browser&apos;s maker), if you turn on notifications. The
              notification is encrypted so they can&apos;t read it.
            </li>
            <li>
              Our <b>hosting and backup providers</b>, which store the servers and their backups.
            </li>
            <li>Professional advisers, and authorities when the law requires it.</li>
          </List>
          <p>
            Some of these providers are in other countries than you. We use providers that protect personal data under
            contract, and send them only what the task needs.
          </p>

          <H2>How long we keep it</H2>
          <List>
            <li>Everything in your account: until you delete it, or delete the account.</li>
            <li>
              When you delete your account, it&apos;s removed from our database at once. Copies in our backups expire
              within 30 days.
            </li>
            <li>
              AI cost records are kept without any link to you, so our spending totals stay correct. Payment records
              (amounts and Paddle IDs) are kept as long as tax and accounting law requires. Paddle keeps its own records
              as merchant of record.
            </li>
            <li>Sign-in attempt counters expire within hours.</li>
          </List>

          <H2>Your rights</H2>
          <p>You can, at any time:</p>
          <List>
            <li>see and correct your information in the app;</li>
            <li>download all of it as a file: Profile → Your data → Download my data;</li>
            <li>delete your account and everything in it: Profile → Your data → Delete account;</li>
            <li>withdraw consent by disconnecting Gmail or turning off notifications;</li>
            <li>
              ask us about your data, object to how we use it, or ask us to restrict it, by writing to{' '}
              <ContactLink operator={operator} />. We answer within one month.
            </li>
          </List>
          <p>
            If you think we&apos;ve handled your data wrongly, you can also complain to the data protection authority
            where you live.
          </p>

          <H2>Cookies and storage</H2>
          <p>
            Shortlist uses only the cookies it needs to work: one keeps you signed in, and one protects connecting
            Gmail. Your browser also stores your settings, such as the light or dark theme. No analytics or advertising
            cookies.
            {legal.payments && ' When you open checkout, Paddle may set cookies of its own to process the payment.'}
          </p>

          <H2>Security</H2>
          <p>
            Connections are encrypted (HTTPS). Passwords and sign-in tokens are stored only as hashes, and the Gmail
            token is encrypted. Other users can never see your data. The person running the server can see account email
            addresses, plans and AI spending, to run the service.
          </p>

          <H2>Children</H2>
          <p>Shortlist is not for anyone under 16, and we don&apos;t knowingly collect their data.</p>

          <H2>Changes</H2>
          <p>
            If we change this policy in a way that matters, we&apos;ll tell you in the app or by email before it takes
            effect.
          </p>
        </>
      )}
    </PolicyPage>
  );
}
