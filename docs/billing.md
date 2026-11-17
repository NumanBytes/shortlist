# Billing and payments

How users pay for a plan: the provider, the data we keep, and the webhook that changes a plan.

> Part of the Shortlist docs. Start with [Agents.md](../Agents.md): the product rules and a
> map of every file. Section numbers are shared across files.

## 20. Payments (built 2026-11-17)

### 20.1 The provider: Paddle, as merchant of record

Plans and their limits are in [§12.5](ai-scoring.md). Choosing who takes the money (2026-11-16/17):

- **Stripe** was the user's first choice — it appears in many job descriptions — but it doesn't
  accept businesses based in Pakistan ([stripe.com/global](https://stripe.com/global)). Using it
  would mean a company in a supported country first (e.g. a US LLC through Stripe Atlas: setup
  costs, a US bank account, yearly US filings).
- **Lemon Squeezy** stopped taking new sign-ups and shuts down on 31 March 2027.
- **Dodo Payments** doesn't accept merchants in Pakistan.
- **Paddle** works with software businesses anywhere except a short sanctions list, which
  doesn't include Pakistan. **Polar** pays out to Pakistan through Stripe Connect Express.

**Paddle, chosen 2026-11-17.** As merchant of record, Paddle is the seller in law: it charges the
card, handles sales tax and VAT, issues receipts and refunds. Shortlist never sees card details.
Going live needs Paddle's review of a live website on our own domain with pricing, terms and a
privacy policy (roadmap); until then everything runs in Paddle's sandbox.

**Stripe-ready by design.** What employers ask about Stripe is the patterns — hosted checkout,
signature-checked webhooks, idempotent event handling, a subscription state machine. They're the
same here, and the provider sits behind one interface (§20.2), so a Stripe adapter is an addition,
not a rewrite, if a Stripe-eligible business ever exists.

### 20.2 Shape

```
browser ──POST /billing/checkout──► API ──POST /transactions──► Paddle
   │                                  (price + userId chosen here)
   └── Paddle.js overlay (transaction id) ── card ──► Paddle
                                                       │
API ◄── POST /billing/webhook (signed) ────────────────┘
  verify → dedupe → order → BillingSubscription + User.plan
```

- `BillingProvider` (`apps/api/src/billing/billing-provider.ts`) is everything we need from a
  provider: create a checkout, change plan, open the portal, read a webhook into a provider-neutral
  `SubscriptionChange` (`packages/shared/src/billing.schema.ts`). `PaddleBillingProvider` is the one
  adapter; it calls Paddle's REST API with `fetch` (no SDK). Injected as `BILLING_PROVIDER`; tests use
  the real adapter with a recording `fetch`, so signatures are checked for real and nothing is paid.
- Without the five `PADDLE_*` settings the provider is null: `/billing` says payments are off, and
  an admin assigns plans as before.
- **Data** (`schema.prisma`): `BillingSubscription` — one per account: provider ids, plan, status,
  current period end, scheduled cancellation, and `lastEventAt`; `BillingEvent` — every webhook event
  by the provider's event id and what happened to it. No payload is kept: it holds the customer's
  email and address, which are Paddle's to hold.

### 20.3 The webhook: four guards

`POST /api/v1/billing/webhook` is `@Public()` — Paddle can't log in — and proven instead by its
signature. In order:

1. **Authenticity.** `Paddle-Signature: ts=…;h1=…`, where h1 is HMAC-SHA256 with the destination's
   secret over `ts:rawBody`, hex (`paddle-signature.ts`, hand-rolled). Checked on the **raw bytes**
   (the app is created with `rawBody: true`): parsing JSON first could change them. A timestamp more
   than **5 seconds** off (Paddle's default) is refused, so a captured request can't be replayed;
   the comparison is constant-time; several h1 values are accepted during a secret rotation. Failure
   → 400, logged with the reason.
2. **Idempotency.** Paddle retries until it gets a 200 (sandbox 3 tries in ~2 minutes, live up to 60
   over ~2 days), so the same event can arrive twice. The `BillingEvent` row (id = Paddle's event id)
   is inserted **first, in the same transaction as the change**: a second copy hits the unique key
   and returns `duplicate`; a change that fails rolls the row back, so Paddle's retry tries again.
3. **Ordering.** Delivery order isn't guaranteed. A subscription keeps the `occurred_at` of the newest
   event it applied; an older one arriving late is recorded `stale` and not applied.
4. **Ownership.** The user is our own record of the subscription, or else the `userId` our server
   wrote into the transaction's `custom_data` (Paddle copies it to the subscription) — trusted only if
   it names a real account — or else an earlier subscription of the same Paddle customer.

Then: an unknown price → `unknown-price`; a second live subscription for one account (two checkouts
opened at once) → `duplicate-subscription`, the first kept and the second logged for a refund;
non-subscription events → `ignored`. All return 200 — retrying wouldn't change them — and are logged.

**The plan follows the status** (`planForSubscription()`): active, trialing and past due keep the
paid plan — past due means Paddle is still retrying the card, and taking the plan away mid-retry
punishes a bank hiccup; paused and canceled mean Free. A scheduled cancellation keeps the plan until
Paddle sends `subscription.canceled`. Every change goes through `assignPlan()`, which also sets the
account's dollar budget to the plan's (§12.5) — the same helper an admin's assignment uses. An admin
can still assign a plan to a subscriber; the next webhook overrides it.

### 20.4 Buying, switching, cancelling

- **Checkout** (`POST /billing/checkout {plan}`): the server creates a Paddle transaction with the
  plan's price and `custom_data.userId` and returns its id; the browser opens it in Paddle.js's
  overlay (`apps/web/src/lib/paddle.ts`, loaded from Paddle's CDN on first use with the public
  client-side token, never an API key). Because the server made the transaction, the browser can't
  change what is bought or for whom. Refused (409) while a subscription is live — a second would bill
  twice. A returning customer reuses their Paddle customer. After `checkout.completed` the card
  polls `/billing` for up to two minutes, until the webhook's plan shows.
- **Switch** (`POST /billing/change-plan {plan}`): Paddle `PATCH /subscriptions/:id` with the new
  price and `prorated_immediately` — an upgrade pays the rest of the month's difference now, a
  downgrade is credited. The plan changes with Paddle's `subscription.updated`, not with the request
  (202). Refused while past due (Paddle refuses it too) or after a scheduled cancellation.
- **Manage billing** (`POST /billing/portal`): a Paddle customer portal session — cancel, change
  card, invoices. Its links carry a short-lived token, so they're fetched on tap and never stored.
- **Who can buy:** a signed-in account with a verified email (the global guard). Plans' prices and
  limits shown in the app come from `PLANS` in shared; the amounts charged come from Paddle's
  catalog — keep them the same.

### 20.5 Setup

`deploy/README.md` "Payments": a Paddle sandbox account, one product with two monthly prices, an API
key, a client-side token, a notification destination at `/api/v1/billing/webhook` for the
`subscription.*` events, the default payment link, and the five `PADDLE_*` settings (all or none; the
API refuses to start with a sandbox key and a live token, or the reverse).
