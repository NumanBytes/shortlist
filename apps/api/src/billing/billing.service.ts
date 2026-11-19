import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { planForSubscription, type PaidPlan, type SubscriptionChange } from '@shortlist/shared';
import type { Prisma } from '@shortlist/db';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assignPlan } from './assign-plan.js';
import { BILLING_PROVIDER, ProviderError, WebhookRejected, type BillingProvider } from './billing-provider.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'PAUSED'] as const;

type Outcome = 'applied' | 'stale' | 'duplicate-subscription' | 'unknown-price' | 'unmatched' | 'ignored';

// Paid plans (docs/billing.md §20). The browser only ever asks to start a checkout, change plan or
// open the portal; a plan changes only when the provider's signed webhook says the money moved.
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider | null,
  ) {}

  async status(userId: string) {
    const [user, sub] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } }),
      this.prisma.billingSubscription.findUnique({ where: { userId } }),
    ]);
    return {
      enabled: this.provider !== null,
      client: this.provider?.client ?? null,
      plan: user.plan,
      subscription: sub
        ? {
            plan: sub.plan,
            status: sub.status,
            currentPeriodEndsAt: sub.currentPeriodEndsAt,
            cancelsAt: sub.cancelsAt,
          }
        : null,
    };
  }

  // A checkout for a paid plan. Refused while the user has a live subscription — a second one
  // would bill them twice; switching plans goes through changePlan().
  async checkout(userId: string, plan: PaidPlan) {
    const provider = this.requireProvider();
    const sub = await this.prisma.billingSubscription.findUnique({ where: { userId } });
    if (sub && sub.status !== 'CANCELED') {
      throw new ConflictException('You already have a subscription — change your plan instead');
    }
    try {
      // A returning customer keeps their Paddle customer (and their invoices in one place).
      return await provider.createCheckout({ userId, plan, customerId: sub?.providerCustomerId ?? null });
    } catch (err) {
      throw this.providerFailure(err);
    }
  }

  // Upgrade or downgrade a live subscription. The new plan arrives with the provider's
  // subscription.updated webhook once the change is billed — never before.
  async changePlan(userId: string, plan: PaidPlan) {
    const provider = this.requireProvider();
    const sub = await this.prisma.billingSubscription.findUnique({ where: { userId } });
    if (!sub || (sub.status !== 'ACTIVE' && sub.status !== 'TRIALING')) {
      throw new ConflictException(
        sub?.status === 'PAST_DUE'
          ? 'Your last payment failed — update your card first'
          : 'You have no active subscription to change',
      );
    }
    if (sub.plan === plan) throw new ConflictException(`You're already on ${plan === 'PRO' ? 'Pro' : 'Starter'}`);
    try {
      await provider.changePlan(sub.providerSubscriptionId, plan);
    } catch (err) {
      throw this.providerFailure(err);
    }
    return { requested: plan };
  }

  // Links to the provider's portal: cancel, change card, download invoices.
  async portal(userId: string) {
    const provider = this.requireProvider();
    const sub = await this.prisma.billingSubscription.findUnique({ where: { userId } });
    if (!sub) throw new NotFoundException('No subscription yet');
    try {
      return await provider.portal(sub.providerCustomerId, sub.providerSubscriptionId);
    } catch (err) {
      throw this.providerFailure(err);
    }
  }

  // A webhook from the provider. Four guards, in order:
  //   1. authenticity — the provider verifies the signature on the raw body (400 otherwise);
  //   2. idempotency — the event id is inserted first, in the same transaction as the change; a
  //      retried delivery hits the unique key and does nothing, and a change that fails rolls the
  //      event row back, so the provider's retry gets another go;
  //   3. ordering — a subscription remembers the newest event it applied; an older one arriving
  //      late is recorded as stale, never applied over a newer state;
  //   4. ownership — the user comes from our own record of the subscription, or else from the
  //      custom data our server wrote when it created the checkout.
  async webhook(signatureHeader: string | undefined, rawBody: Buffer | undefined) {
    if (!this.provider) throw new NotFoundException();
    if (!rawBody) throw new BadRequestException('Empty body');
    let read: ReturnType<BillingProvider['readWebhook']>;
    try {
      read = this.provider.readWebhook(signatureHeader, rawBody);
    } catch (err) {
      if (err instanceof WebhookRejected) {
        this.logger.warn(`Webhook rejected: ${err.message}`);
        throw new BadRequestException('Invalid webhook');
      }
      throw err;
    }
    const provider = this.provider;
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        if ('ignored' in read) {
          await this.recordEvent(tx, read.eventId, read.ignored, read.occurredAt, 'ignored');
          return 'ignored' as const;
        }
        await this.recordEvent(tx, read.eventId, read.type, read.occurredAt, 'pending');
        const result = await this.apply(tx, read, provider);
        await tx.billingEvent.update({ where: { id: read.eventId }, data: { outcome: result } });
        return result;
      });
      if (outcome !== 'applied' && outcome !== 'ignored') {
        this.logger.warn(`Webhook ${'eventId' in read ? read.eventId : ''} not applied: ${outcome}`);
      }
      return { received: true, outcome };
    } catch (err) {
      if (isUniqueViolation(err)) return { received: true, outcome: 'duplicate' };
      throw err;
    }
  }

  private recordEvent(tx: Prisma.TransactionClient, id: string, type: string, occurredAt: Date, outcome: string) {
    return tx.billingEvent.create({ data: { id, provider: this.provider!.name, type, occurredAt, outcome } });
  }

  private async apply(
    tx: Prisma.TransactionClient,
    change: SubscriptionChange,
    provider: BillingProvider,
  ): Promise<Outcome> {
    const known = await tx.billingSubscription.findUnique({
      where: { providerSubscriptionId: change.subscriptionId },
    });
    const userId = known?.userId ?? (await this.userFromEvent(tx, change));
    if (!userId) return 'unmatched';
    if (known && known.lastEventAt >= change.occurredAt) return 'stale';
    const plan = change.priceId ? provider.planForPrice(change.priceId) : null;
    if (!plan) return 'unknown-price';

    const current = known ?? (await tx.billingSubscription.findUnique({ where: { userId } }));
    if (current && current.providerSubscriptionId !== change.subscriptionId) {
      // A second subscription for one account: checkout refuses that, so it means a checkout
      // opened twice in parallel. Keep the live one; the duplicate is logged for a refund.
      if ((LIVE as readonly string[]).includes(current.status)) return 'duplicate-subscription';
    }
    const data = {
      provider: provider.name,
      providerSubscriptionId: change.subscriptionId,
      providerCustomerId: change.customerId,
      plan,
      status: change.status,
      currentPeriodEndsAt: change.currentPeriodEndsAt,
      cancelsAt: change.status === 'CANCELED' ? null : change.cancelsAt,
      lastEventAt: change.occurredAt,
    };
    await tx.billingSubscription.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    await assignPlan(tx, userId, planForSubscription(change.status, plan));
    return 'applied';
  }

  // The user id our server put in the checkout's custom data — trusted only if it names a real
  // account. A returning customer's new subscription is also matched by their customer id.
  private async userFromEvent(tx: Prisma.TransactionClient, change: SubscriptionChange) {
    if (change.userId && UUID.test(change.userId)) {
      const user = await tx.user.findUnique({ where: { id: change.userId }, select: { id: true } });
      if (user) return user.id;
    }
    const byCustomer = await tx.billingSubscription.findFirst({
      where: { providerCustomerId: change.customerId },
      select: { userId: true },
    });
    return byCustomer?.userId ?? null;
  }

  private requireProvider(): BillingProvider {
    if (!this.provider) throw new ServiceUnavailableException("Payments aren't set up on this server");
    return this.provider;
  }

  private providerFailure(err: unknown) {
    if (err instanceof ProviderError) {
      this.logger.error(err.message);
      return new BadGatewayException("The payment provider didn't respond as expected — try again in a minute");
    }
    return err;
  }
}
