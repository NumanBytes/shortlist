import { PaddleEventSchema, paddleSubscriptionChange, planForSubscription } from './billing.schema.js';

const event = (over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) =>
  PaddleEventSchema.parse({
    event_id: 'evt_01',
    event_type: 'subscription.updated',
    occurred_at: '2026-11-17T10:00:00.000Z',
    notification_id: 'ntf_01',
    ...over,
    data: {
      id: 'sub_01',
      status: 'active',
      customer_id: 'ctm_01',
      custom_data: { userId: 'u1' },
      items: [{ price: { id: 'pri_starter' }, quantity: 1 }],
      current_billing_period: { starts_at: '2026-11-17T10:00:00Z', ends_at: '2026-12-17T10:00:00Z' },
      scheduled_change: null,
      ...data,
    },
  });

describe('paddleSubscriptionChange', () => {
  it('reads what decides the plan from a subscription event', () => {
    expect(paddleSubscriptionChange(event())).toEqual({
      eventId: 'evt_01',
      type: 'subscription.updated',
      occurredAt: new Date('2026-11-17T10:00:00Z'),
      subscriptionId: 'sub_01',
      customerId: 'ctm_01',
      status: 'ACTIVE',
      priceId: 'pri_starter',
      userId: 'u1',
      currentPeriodEndsAt: new Date('2026-12-17T10:00:00Z'),
      cancelsAt: null,
    });
  });

  it('records a scheduled cancellation, not a scheduled pause', () => {
    const at = '2026-12-17T10:00:00Z';
    expect(
      paddleSubscriptionChange(event({}, { scheduled_change: { action: 'cancel', effective_at: at } }))?.cancelsAt,
    ).toEqual(new Date(at));
    expect(
      paddleSubscriptionChange(event({}, { scheduled_change: { action: 'pause', effective_at: at } }))?.cancelsAt,
    ).toBeNull();
  });

  it('ignores events that are not about a subscription', () => {
    expect(paddleSubscriptionChange(event({ event_type: 'transaction.completed' }))).toBeNull();
  });

  it('refuses a subscription event with data it cannot read', () => {
    expect(() => paddleSubscriptionChange(event({}, { status: 'frozen' }))).toThrow();
    expect(() => paddleSubscriptionChange(event({}, { items: [] }))).toThrow();
  });

  it('takes no user id that is not a string', () => {
    expect(paddleSubscriptionChange(event({}, { custom_data: { userId: 42 } }))?.userId).toBeNull();
  });
});

describe('planForSubscription', () => {
  it('keeps the plan while active, trialing or retrying a card; Free when paused or canceled', () => {
    expect(
      ['ACTIVE', 'TRIALING', 'PAST_DUE', 'PAUSED', 'CANCELED'].map((s) => planForSubscription(s as never, 'PRO')),
    ).toEqual(['PRO', 'PRO', 'PRO', 'FREE', 'FREE']);
  });
});
