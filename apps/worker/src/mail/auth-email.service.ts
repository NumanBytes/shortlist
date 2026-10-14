import { Inject, Injectable } from '@nestjs/common';
import type { SendAuthEmailData } from '@shortlist/shared';
import { newOneTimeToken } from '@shortlist/shared/node';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MAILER, type MailMessage, type Mailer } from './mailer.js';

const HOUR = 3600 * 1000;
const LIFETIME = { VERIFY_EMAIL: 24 * HOUR, RESET_PASSWORD: HOUR } as const;

// Makes a one-time token and emails its link (docs/security.md §8.7). The token is created
// here, not in the API, so the plain value never sits in Redis or the database — only its
// SHA-256 is stored. A new email replaces the user's earlier unused links of that kind, so
// only the newest one works.
@Injectable()
export class AuthEmailService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async send({ userId, purpose }: SendAuthEmailData): Promise<{ sent: boolean; reason?: string }> {
    if (!this.mailer.configured) return { sent: false, reason: 'SMTP is not configured' };
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, emailVerifiedAt: true },
    });
    if (!user) return { sent: false, reason: 'user is gone' };
    if (purpose === 'VERIFY_EMAIL' && user.emailVerifiedAt) return { sent: false, reason: 'already verified' };

    const { token, tokenHash } = newOneTimeToken();
    await this.prisma.$transaction([
      this.prisma.authToken.deleteMany({ where: { userId, purpose, usedAt: null } }),
      this.prisma.authToken.create({
        data: { userId, purpose, tokenHash, expiresAt: new Date(Date.now() + LIFETIME[purpose]) },
      }),
    ]);
    await this.mailer.send(this.message(purpose, user, token));
    return { sent: true };
  }

  private message(
    purpose: SendAuthEmailData['purpose'],
    user: { email: string; name: string },
    token: string,
  ): MailMessage {
    const base = this.env.WEB_APP_URL.replace(/\/$/, '');
    const verify = purpose === 'VERIFY_EMAIL';
    // The token is in the link's query string; the page POSTs it and removes it from the
    // address bar, so it doesn't linger in history or leak to other sites as a referrer.
    const link = `${base}/${verify ? 'verify-email' : 'reset-password'}?token=${token}`;
    const first = user.name.split(/\s+/)[0] || 'there';
    const subject = verify ? 'Confirm your email for Shortlist' : 'Reset your Shortlist password';
    const lines = verify
      ? [
          `Hi ${first},`,
          'Confirm this is your email address to start using Shortlist:',
          link,
          'The link works for 24 hours.',
        ]
      : [
          `Hi ${first},`,
          'Someone asked to reset the password for this Shortlist account. If it was you, choose a new one here:',
          link,
          "The link works for one hour. If you didn't ask, ignore this email — your password stays the same.",
        ];
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = lines
      .map((l) =>
        l === link
          ? `<p><a href="${esc(link)}">${verify ? 'Confirm my email' : 'Choose a new password'}</a></p>`
          : `<p>${esc(l)}</p>`,
      )
      .join('\n');
    return { to: user.email, subject, text: lines.join('\n\n'), html };
  }
}
