import { PaddleEventSchema, paddleSubscriptionChange, type PaidPlan, type SubscriptionChange } from '@shortlist/shared';
import type { Env } from '../config/env.js';
import { verifyPaddleSignature } from './paddle-signature.js';

// Everything Shortlist needs from a payment provider (docs/billing.md §20.2). Paddle is the only
// adapter; the interface keeps the rest of billing — idempotency, ordering, plans — free of any one
// provider's shapes, so another (Stripe, for a business in a country it serves) is an adapter, not
// a rewrite. Injected as BILLING_PROVIDER so tests can record calls instead of paying.
export interface BillingProvider {
  readonly name: string;
  // What the browser needs to open the provider's checkout. Public by design.
  readonly client: { environment: 'sandbox' | 'production'; token: string };
  planForPrice(priceId: string): PaidPlan | null;
  // A checkout for this plan, tied to this user. `customerId` reuses a returning customer.
  createCheckout(input: { userId: string; plan: PaidPlan; customerId: string | null }): Promise<{ checkoutId: string }>;
  // Switch a live subscription to another plan, charging or crediting the difference now.
  changePlan(subscriptionId: string, plan: PaidPlan): Promise<void>;
  // Short-lived links to the provider's customer portal (cancel, card, invoices). Never stored.
  portal(customerId: string, subscriptionId: string): Promise<{ overview: string; cancel: string | null }>;
  // A webhook: verified, then turned into a subscription change, or null when it isn't one.
  // Throws WebhookRejected when it isn't authentic or can't be read.
  readWebhook(
    signatureHeader: string | undefined,
    rawBody: Buffer,
  ): SubscriptionChange | { ignored: string; eventId: string; occurredAt: Date };
}

export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER');

export class WebhookRejected extends Error {}
export class ProviderError extends Error {}

type Fetch = typeof fetch;

export class PaddleBillingProvider implements BillingProvider {
  readonly name = 'paddle';
  readonly client: BillingProvider['client'];
  private readonly baseUrl: string;
  private readonly prices: Record<PaidPlan, string>;

  constructor(
    private readonly env: Required<
      Pick<
        Env,
        'PADDLE_API_KEY' | 'PADDLE_WEBHOOK_SECRET' | 'PADDLE_CLIENT_TOKEN' | 'PADDLE_PRICE_STARTER' | 'PADDLE_PRICE_PRO'
      >
    >,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    const sandbox = env.PADDLE_API_KEY.startsWith('pdl_sdbx_');
    this.baseUrl = sandbox ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
    this.client = { environment: sandbox ? 'sandbox' : 'production', token: env.PADDLE_CLIENT_TOKEN };
    this.prices = { STARTER: env.PADDLE_PRICE_STARTER, PRO: env.PADDLE_PRICE_PRO };
  }

  planForPrice(priceId: string): PaidPlan | null {
    return (Object.keys(this.prices) as PaidPlan[]).find((p) => this.prices[p] === priceId) ?? null;
  }

  // A transaction made on the server, opened in Paddle.js by its id. The server, not the browser,
  // decides the price and writes the user's id into custom_data, which Paddle copies to the
  // subscription — that's how the webhook knows whose plan to change.
  async createCheckout({ userId, plan, customerId }: { userId: string; plan: PaidPlan; customerId: string | null }) {
    const res = await this.call<{ data: { id: string } }>('POST', '/transactions', {
      items: [{ price_id: this.prices[plan], quantity: 1 }],
      custom_data: { userId },
      ...(customerId ? { customer_id: customerId } : {}),
    });
    return { checkoutId: res.data.id };
  }

  async changePlan(subscriptionId: string, plan: PaidPlan) {
    await this.call('PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      items: [{ price_id: this.prices[plan], quantity: 1 }],
      proration_billing_mode: 'prorated_immediately',
    });
  }

  async portal(customerId: string, subscriptionId: string) {
    const res = await this.call<{
      data: { urls: { general: { overview: string }; subscriptions: { id: string; cancel_subscription: string }[] } };
    }>('POST', `/customers/${encodeURIComponent(customerId)}/portal-sessions`, { subscription_ids: [subscriptionId] });
    const sub = res.data.urls.subscriptions.find((s) => s.id === subscriptionId);
    return { overview: res.data.urls.general.overview, cancel: sub?.cancel_subscription ?? null };
  }

  readWebhook(signatureHeader: string | undefined, rawBody: Buffer) {
    const check = verifyPaddleSignature(signatureHeader, rawBody, this.env.PADDLE_WEBHOOK_SECRET);
    if (!check.ok) throw new WebhookRejected(check.reason);
    let event;
    try {
      event = PaddleEventSchema.parse(JSON.parse(rawBody.toString('utf8')));
    } catch {
      throw new WebhookRejected('not a Paddle event');
    }
    try {
      return (
        paddleSubscriptionChange(event) ?? {
          ignored: event.event_type,
          eventId: event.event_id,
          occurredAt: new Date(event.occurred_at),
        }
      );
    } catch {
      throw new WebhookRejected(`unreadable ${event.event_type} data`);
    }
  }

  private async call<T = unknown>(method: string, path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.env.PADDLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Paddle's error body names the problem (and never echoes the key); keep it for the log.
      const detail = await res.text().catch(() => '');
      throw new ProviderError(`Paddle ${method} ${path} answered ${res.status}: ${detail.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }
}
