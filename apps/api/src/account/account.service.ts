import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import { BILLING_PROVIDER, type BillingProvider } from '../billing/billing-provider.js';
import { GmailService } from '../gmail/gmail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export class WrongPassword extends BadRequestException {
  constructor() {
    super({
      message: 'That password is not right',
      errors: [{ path: 'password', message: 'That password is not right' }],
    });
  }
}

// The user's own data rights (docs/security.md §8.8): take everything with you, or have it
// all removed. Both are self-serve — no email to an operator, no waiting.
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailService,
    @Optional() @Inject(BILLING_PROVIDER) private readonly billing: BillingProvider | null = null,
  ) {}

  // Deletes the account and everything in it, in this order:
  //   1. the password, again — an open session alone is not enough;
  //   2. a live paid subscription is cancelled at Paddle first. If that fails nothing is
  //      deleted: a deleted account with a live subscription would keep being charged, with
  //      no way left to stop it from here;
  //   3. Gmail access is revoked at Google (best effort, like "Disconnect");
  //   4. one DELETE of the user row. Every table that belongs to an account cascades from it;
  //      AiUsage rows stay with userId null so the server's monthly AI cap still counts them.
  async delete(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, billingSubscription: { select: { providerSubscriptionId: true, status: true } } },
    });
    if (!user) throw new NotFoundException();
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new WrongPassword();

    const sub = user.billingSubscription;
    if (sub && sub.status !== 'CANCELED') {
      if (!this.billing) {
        // Payments were switched off on this server after the user subscribed.
        throw new ConflictException(
          'Your subscription could not be cancelled here. Contact support to delete your account.',
        );
      }
      try {
        await this.billing.cancelNow(sub.providerSubscriptionId);
      } catch (err) {
        this.logger.error(
          `Cancelling ${sub.providerSubscriptionId} before deleting an account failed: ${(err as Error).message}`,
        );
        throw new BadGatewayException(
          'Your subscription could not be cancelled, so nothing was deleted. Try again in a minute, or cancel it in Manage billing first.',
        );
      }
    }

    await this.gmail.disconnect(userId);
    await this.prisma.user.delete({ where: { id: userId } });
    this.logger.log(`Account ${userId} deleted by its owner`);
  }

  // Everything the account holds, as one JSON document. Secrets are left out — the password
  // hash, session and one-time token hashes, the sealed Gmail token, push encryption keys —
  // they are credentials, not the user's data, and a leaked export must not work as a login.
  // A new secret column must be added to the omissions here (a test checks the known ones).
  async export(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      omit: { passwordHash: true },
      include: {
        workExperiences: true,
        projects: true,
        skills: { include: { evidence: true } },
        education: true,
        neverClaims: true,
        careerImports: true,
        jobSources: true,
        discoveryPrefs: true,
        jobs: { include: { requirements: true, match: { include: { gaps: true } }, resume: true } },
        resumeVariants: true,
        aiSettings: true,
        aiUsage: true,
        notificationSettings: true,
        notifications: true,
        pushSubscriptions: { select: { id: true, userAgent: true, lastSentAt: true, createdAt: true } },
        gmail: { omit: { refreshTokenEnc: true } },
        emailMessages: true,
        billingSubscription: true,
      },
    });
    if (!user) throw new NotFoundException();
    return { exportedAt: new Date().toISOString(), format: 'shortlist-export-v1', account: user };
  }
}
