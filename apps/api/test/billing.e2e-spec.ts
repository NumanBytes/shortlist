import { BILLING_PROVIDER, PaddleBillingProvider } from '../src/billing/billing-provider.js';
import { signPaddleBody } from '../src/billing/paddle-signature.js';
import { createTestApp, type TestApp, type TestUser } from './helpers.js';

// Payments (docs/billing.md §20) against the real Paddle adapter — real signature checks — with
// Paddle's HTTP API replaced by a recorder: no network, no money.
const PADDLE = {
  PADDLE_API_KEY: 'pdl_sdbx_apikey_test',
  PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_test_secret',
  PADDLE_CLIENT_TOKEN: 'test_clienttoken',
  PADDLE_PRICE_STARTER: 'pri_starter',
  PADDLE_PRICE_PRO: 'pri_pro',
};

type Call = { method: string; url: string; body: Record<string, unknown> };

describe('Billing (e2e)', () => {
  let t: TestApp;
  const calls: Call[] = [];
  const eventIds: string[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ method: init.method!, url, body: JSON.parse(init.body as string) });
    const json = url.endsWith('/transactions')
      ? { data: { id: 'txn_test' } }
      : url.includes('/portal-sessions')
        ? {
            data: {
              urls: {
                general: { overview: 'https://portal.test/overview' },
                subscriptions: [{ id: 'sub_x', cancel_subscription: 'https://portal.test/cancel' }],
              },
            },
          }
        : { data: {} };
    return new Response(JSON.stringify(json), { status: 200 });
  }) as typeof fetch;

  beforeAll(async () => {
    t = await createTestApp((b) =>
      b.overrideProvider(BILLING_PROVIDER).useValue(new PaddleBillingProvider(PADDLE, fakeFetch)),
    );
  });

  afterAll(async () => {
    await t.prisma.billingEvent.deleteMany({ where: { id: { in: eventIds } } });
    await t.close();
  });

  // A Paddle subscription event, signed as Paddle signs it.
  function subscriptionEvent(
    u: TestUser | null,
    over: { type?: string; at?: string; status?: string; price?: string; sub?: string; customer?: string } = {},
    data: Record<string, unknown> = {},
  ) {
    const eventId = `evt_${crypto.randomUUID().replace(/-/g, '')}`;
    eventIds.push(eventId);
    return JSON.stringify({
      event_id: eventId,
      event_type: over.type ?? 'subscription.created',
      occurred_at: over.at ?? new Date().toISOString(),
      notification_id: 'ntf_test',
      data: {
        id: over.sub ?? `sub_${u?.user.id ?? 'x'}`,
        status: over.status ?? 'active',
        customer_id: over.customer ?? `ctm_${u?.user.id ?? 'x'}`,
        custom_data: u ? { userId: u.user.id } : null,
        items: [{ price: { id: over.price ?? 'pri_starter' }, quantity: 1 }],
        current_billing_period: { starts_at: '2026-11-17T00:00:00Z', ends_at: '2026-12-17T00:00:00Z' },
        scheduled_change: null,
        ...data,
      },
    });
  }
  const deliver = (body: string, signature = signPaddleBody(body, PADDLE.PADDLE_WEBHOOK_SECRET)) =>
    t
      .http()
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Paddle-Signature', signature)
      .send(body);
  const planOf = async (u: TestUser) =>
    await t.prisma.user.findUniqueOrThrow({ where: { id: u.user.id }, include: { aiSettings: true } });

  it('starts a checkout on the server, with the price and the user chosen there', async () => {
    const u = await t.register();
    const res = await t.http().post('/api/v1/billing/checkout').set(u.auth).send({ plan: 'PRO' }).expect(201);
    expect(res.body).toEqual({ checkoutId: 'txn_test' });
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      url: 'https://sandbox-api.paddle.com/transactions',
      body: { items: [{ price_id: 'pri_pro', quantity: 1 }], custom_data: { userId: u.user.id } },
    });
    await t.http().post('/api/v1/billing/checkout').set(u.auth).send({ plan: 'FREE' }).expect(400);
    await t.http().post('/api/v1/billing/checkout').set(u.auth).send({ plan: 'PRO', price: 0 }).expect(400);
  });

  it('reports the plan, and what the browser needs to open checkout', async () => {
    const u = await t.register();
    const res = await t.http().get('/api/v1/billing').set(u.auth).expect(200);
    expect(res.body).toEqual({
      enabled: true,
      client: { environment: 'sandbox', token: 'test_clienttoken' },
      plan: 'FREE',
      subscription: null,
    });
  });

  it('refuses a webhook that is unsigned, mis-signed or replayed — and needs no login', async () => {
    const u = await t.register();
    const body = subscriptionEvent(u);
    await t.http().post('/api/v1/billing/webhook').set('Content-Type', 'application/json').send(body).expect(400);
    await deliver(body, signPaddleBody(body, 'pdl_ntfset_wrong')).expect(400);
    await deliver(body, signPaddleBody(body, PADDLE.PADDLE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 600)).expect(
      400,
    );
    await deliver(body.replace('pri_starter', 'pri_pro'), signPaddleBody(body, PADDLE.PADDLE_WEBHOOK_SECRET)).expect(
      400,
    );
    expect((await planOf(u)).plan).toBe('FREE');
  });

  it('gives the plan when the subscription starts, once, however often the event arrives', async () => {
    const u = await t.register();
    const body = subscriptionEvent(u);
    expect((await deliver(body).expect(200)).body).toEqual({ received: true, outcome: 'applied' });
    expect((await deliver(body).expect(200)).body).toEqual({ received: true, outcome: 'duplicate' });
    const user = await planOf(u);
    expect(user.plan).toBe('STARTER');
    expect(Number(user.aiSettings!.monthlyBudgetUsd)).toBe(4);
    const status = await t.http().get('/api/v1/billing').set(u.auth).expect(200);
    expect(status.body.subscription).toMatchObject({ plan: 'STARTER', status: 'ACTIVE', cancelsAt: null });
  });

  it('ignores an older event that arrives after a newer one', async () => {
    const u = await t.register();
    const now = Date.now();
    await deliver(
      subscriptionEvent(u, { type: 'subscription.updated', at: new Date(now).toISOString(), price: 'pri_pro' }),
    ).expect(200);
    const late = await deliver(
      subscriptionEvent(u, {
        type: 'subscription.created',
        at: new Date(now - 60_000).toISOString(),
        price: 'pri_starter',
      }),
    ).expect(200);
    expect(late.body.outcome).toBe('stale');
    expect((await planOf(u)).plan).toBe('PRO');
  });

  it('keeps the plan through a scheduled cancellation and a failed payment, Free once canceled', async () => {
    const u = await t.register();
    const at = (s: number) => new Date(Date.now() + s * 1000).toISOString();
    await deliver(subscriptionEvent(u, { at: at(0), price: 'pri_pro' })).expect(200);
    await deliver(
      subscriptionEvent(
        u,
        { type: 'subscription.updated', at: at(1), price: 'pri_pro' },
        {
          scheduled_change: { action: 'cancel', effective_at: '2026-12-17T00:00:00Z' },
        },
      ),
    ).expect(200);
    expect((await planOf(u)).plan).toBe('PRO');
    expect((await t.http().get('/api/v1/billing').set(u.auth)).body.subscription.cancelsAt).toBe(
      '2026-12-17T00:00:00.000Z',
    );
    await deliver(
      subscriptionEvent(u, { type: 'subscription.past_due', at: at(2), status: 'past_due', price: 'pri_pro' }),
    ).expect(200);
    expect((await planOf(u)).plan).toBe('PRO');
    await deliver(
      subscriptionEvent(u, { type: 'subscription.canceled', at: at(3), status: 'canceled', price: 'pri_pro' }),
    ).expect(200);
    const user = await planOf(u);
    expect(user.plan).toBe('FREE');
    expect(Number(user.aiSettings!.monthlyBudgetUsd)).toBe(1);

    // Subscribing again reuses the Paddle customer.
    await t.http().post('/api/v1/billing/checkout').set(u.auth).send({ plan: 'STARTER' }).expect(201);
    expect(calls.at(-1)!.body).toMatchObject({ customer_id: `ctm_${u.user.id}` });
  });

  it('refuses a second checkout while subscribed, and changes plans through Paddle instead', async () => {
    const u = await t.register();
    await deliver(subscriptionEvent(u)).expect(200);
    await t.http().post('/api/v1/billing/checkout').set(u.auth).send({ plan: 'PRO' }).expect(409);
    await t.http().post('/api/v1/billing/change-plan').set(u.auth).send({ plan: 'STARTER' }).expect(409);
    await t.http().post('/api/v1/billing/change-plan').set(u.auth).send({ plan: 'PRO' }).expect(202);
    expect(calls.at(-1)).toEqual({
      method: 'PATCH',
      url: `https://sandbox-api.paddle.com/subscriptions/sub_${u.user.id}`,
      body: { items: [{ price_id: 'pri_pro', quantity: 1 }], proration_billing_mode: 'prorated_immediately' },
    });
    // The plan changes with Paddle's webhook, not with the request.
    expect((await planOf(u)).plan).toBe('STARTER');
  });

  it('opens the customer portal for the subscription', async () => {
    const u = await t.register();
    await t.http().post('/api/v1/billing/portal').set(u.auth).expect(404);
    await deliver(subscriptionEvent(u)).expect(200);
    const res = await t.http().post('/api/v1/billing/portal').set(u.auth).expect(201);
    expect(res.body).toEqual({ overview: 'https://portal.test/overview', cancel: null });
    expect(calls.at(-1)).toMatchObject({
      url: `https://sandbox-api.paddle.com/customers/ctm_${u.user.id}/portal-sessions`,
      body: { subscription_ids: [`sub_${u.user.id}`] },
    });
  });

  it('records but does not apply events it cannot place: unknown price, unknown user, other types', async () => {
    const u = await t.register();
    expect((await deliver(subscriptionEvent(u, { price: 'pri_unknown' })).expect(200)).body.outcome).toBe(
      'unknown-price',
    );
    expect((await deliver(subscriptionEvent(null)).expect(200)).body.outcome).toBe('unmatched');
    const forged = subscriptionEvent(null, {}, { custom_data: { userId: crypto.randomUUID() } });
    expect((await deliver(forged).expect(200)).body.outcome).toBe('unmatched');
    const other = JSON.parse(subscriptionEvent(u)) as Record<string, unknown>;
    other.event_type = 'transaction.completed';
    const body = JSON.stringify(other);
    expect((await deliver(body).expect(200)).body.outcome).toBe('ignored');
    expect((await deliver(body).expect(200)).body.outcome).toBe('duplicate');
    expect((await planOf(u)).plan).toBe('FREE');
  });

  it('keeps one subscription per account if a second one appears', async () => {
    const u = await t.register();
    await deliver(subscriptionEvent(u, { sub: 'sub_first' })).expect(200);
    const second = await deliver(subscriptionEvent(u, { sub: 'sub_second', price: 'pri_pro' })).expect(200);
    expect(second.body.outcome).toBe('duplicate-subscription');
    expect((await planOf(u)).plan).toBe('STARTER');
  });
});

describe('Billing without Paddle settings (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp((b) => b.overrideProvider(BILLING_PROVIDER).useValue(null));
  });
  afterAll(async () => {
    await t.close();
  });

  it('says payments are off and refuses to start one', async () => {
    const u = await t.register();
    expect((await t.http().get('/api/v1/billing').set(u.auth).expect(200)).body).toMatchObject({
      enabled: false,
      client: null,
    });
    await t.http().post('/api/v1/billing/checkout').set(u.auth).send({ plan: 'PRO' }).expect(503);
    await t.http().post('/api/v1/billing/webhook').send('{}').expect(404);
  });
});
