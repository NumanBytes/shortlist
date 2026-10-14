import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

// The one place the worker sends email (docs/security.md §8.7). An interface so tests use a
// fake and never reach a mail server. Sent with Nodemailer: SMTP with STARTTLS/TLS, AUTH and
// MIME is a library's job — the parts worth understanding (tokens, hashing, single use,
// not revealing which emails have accounts) are ours.
export interface Mailer {
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}
export const MAILER = Symbol('MAILER');

export class SmtpMailer implements Mailer {
  private transport: Transporter | null = null;

  constructor(private readonly env: Env) {}

  get configured() {
    return Boolean(this.env.SMTP_HOST);
  }

  async send(message: MailMessage) {
    this.transport ??= nodemailer.createTransport({
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      secure: this.env.SMTP_PORT === 465,
      requireTLS: this.env.SMTP_PORT !== 465, // never send credentials or links in clear text
      auth: { user: this.env.SMTP_USER!, pass: this.env.SMTP_PASSWORD! },
      connectionTimeout: 20_000,
    });
    await this.transport.sendMail({ from: this.env.SMTP_FROM, ...message });
  }
}
