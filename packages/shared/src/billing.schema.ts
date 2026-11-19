import { z } from 'zod';
import type { PlanName } from './plans.js';

// Billing (docs/billing.md §20). The provider — Paddle today — is the merchant of record. Our side
// is provider-neutral: a provider adapter turns its webhooks into a SubscriptionChange, and
// everything after that (who the user is, which plan they get) is ours.

// What a user can buy. Free isn't sold; it's what you have without a subscription.
// Change-of-mind refunds through Paddle, in days from the payment (docs/security.md §8.9). Paddle
// requires 14–90; the refund policy page shows this number.
export const REFUND_WINDOW_DAYS = 14;

export const PaidPlan = z.enum(['STARTER', 'PRO']);
export type PaidPlan = z.infer<typeof PaidPlan>;

export const CheckoutSchema = z.object({ plan: PaidPlan }).strict();
export type CheckoutInput = z.infer<typeof CheckoutSchema>;

export const ChangePlanSchema = z.object({ plan: PaidPlan }).strict();
export type ChangePlanInput = z.infer<typeof ChangePlanSchema>;

export const BILLING_STATUSES = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'PAUSED', 'CANCELED'] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

// One subscription event, provider-neutral.
export interface SubscriptionChange {
  eventId: string; // the provider's event id: the idempotency key
  type: string; // the provider's event type, for the log
  occurredAt: Date; // for ordering: events can arrive out of order
  subscriptionId: string;
  customerId: string;
  status: BillingStatus;
  priceId: string | null; // the base plan's price
  userId: string | null; // ours, from the custom data set when checkout was created
  currentPeriodEndsAt: Date | null;
  cancelsAt: Date | null; // a scheduled cancellation
}

// The plan a subscription gives. Active, trialing and past-due keep it — past due means the
// provider is still retrying the card, and taking the plan away mid-retry would punish a bank
// hiccup. Paused and canceled mean Free. A scheduled cancellation keeps the plan until it takes
// effect; the provider sends a "canceled" event then.
export function planForSubscription(status: BillingStatus, plan: PaidPlan): PlanName {
  return status === 'ACTIVE' || status === 'TRIALING' || status === 'PAST_DUE' ? plan : 'FREE';
}

// ── Paddle Billing webhooks (https://developer.paddle.com/webhooks) ─────────────────────────
// Validated before anything is read, so a malformed event is a logged 400, never a crash or a
// half-applied change. Only the fields we use; Paddle's others pass through untouched.
const isoDate = z.string().datetime({ offset: true });

const PaddleSubscriptionData = z.object({
  id: z.string().startsWith('sub_'),
  status: z.enum(['active', 'trialing', 'past_due', 'paused', 'canceled']),
  customer_id: z.string().startsWith('ctm_'),
  custom_data: z.record(z.string(), z.unknown()).nullable().optional(),
  items: z.array(z.object({ price: z.object({ id: z.string() }) })).min(1),
  current_billing_period: z.object({ starts_at: isoDate, ends_at: isoDate }).nullable().optional(),
  scheduled_change: z
    .object({ action: z.enum(['cancel', 'pause', 'resume']), effective_at: isoDate })
    .nullable()
    .optional(),
});

export const PaddleEventSchema = z.object({
  event_id: z.string().startsWith('evt_'),
  event_type: z.string().min(1),
  occurred_at: isoDate,
  data: z.unknown(),
});
export type PaddleEvent = z.infer<typeof PaddleEventSchema>;

const STATUS: Record<z.infer<typeof PaddleSubscriptionData>['status'], BillingStatus> = {
  active: 'ACTIVE',
  trialing: 'TRIALING',
  past_due: 'PAST_DUE',
  paused: 'PAUSED',
  canceled: 'CANCELED',
};

// A Paddle event → a SubscriptionChange, or null for events that don't change a subscription
// (transactions, customers…). Throws on a subscription event whose data doesn't parse.
export function paddleSubscriptionChange(event: PaddleEvent): SubscriptionChange | null {
  if (!event.event_type.startsWith('subscription.')) return null;
  const data = PaddleSubscriptionData.parse(event.data);
  const userId = data.custom_data?.userId;
  return {
    eventId: event.event_id,
    type: event.event_type,
    occurredAt: new Date(event.occurred_at),
    subscriptionId: data.id,
    customerId: data.customer_id,
    status: STATUS[data.status],
    priceId: data.items[0]!.price.id,
    userId: typeof userId === 'string' ? userId : null,
    currentPeriodEndsAt: data.current_billing_period ? new Date(data.current_billing_period.ends_at) : null,
    cancelsAt: data.scheduled_change?.action === 'cancel' ? new Date(data.scheduled_change.effective_at) : null,
  };
}
