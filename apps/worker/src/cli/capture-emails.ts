// Development helper: save recent job-alert emails from YOUR Shortlist label as .eml files,
// so portal parsers can be written and tested against real messages.
//   pnpm --filter @shortlist/worker capture:emails you@gmail.com [max=40]
//
// Files go to test/fixtures/email/.private/<sender>/, which is git-ignored: they contain
// your name, address and tracking links. A parser's committed fixture must be a scrubbed
// copy (docs/email-alerts.md §10.4) — never one of these files as-is.
import { HttpGmailApi, HttpGoogleOAuth, SecretBox } from '@shortlist/shared/node';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@shortlist/db';
import { loadEnv } from '../config/env.js';

const [email, maxArg] = process.argv.slice(2);
if (!email) {
  console.error('Usage: capture:emails <your account email> [max]');
  process.exit(1);
}
const max = Number(maxArg ?? 40);
const env = loadEnv();
if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
  console.error('Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY in apps/worker/.env');
  process.exit(1);
}

const prisma = new PrismaClient();
const user = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() }, include: { gmail: true } });
if (!user.gmail) throw new Error('Gmail is not connected for this account — connect it on the Sources page first');

const box = new SecretBox(env.TOKEN_ENCRYPTION_KEY);
const oauth = new HttpGoogleOAuth({
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  redirectUri: '',
});
const gmail = new HttpGmailApi();
const token = await oauth.refreshAccessToken(box.open(user.gmail.refreshTokenEnc, user.id));

const label = (await gmail.labels(token)).find((l) => l.name.toLowerCase() === user.gmail!.labelName.toLowerCase());
if (!label) throw new Error(`No "${user.gmail.labelName}" label in ${user.gmail.emailAddress}`);

const { messages } = await gmail.listMessages(token, { labelId: label.id, query: 'newer_than:30d' });
const root = join(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/email/.private');
const bySender = new Map<string, number>();
for (const { id } of messages.slice(0, max)) {
  const m = await gmail.getMessage(token, id, 'raw');
  const raw = Buffer.from(m.raw ?? '', 'base64url').toString('utf8');
  const sender = (/^From:.*?<?([^<>\s]+@[^<>\s]+)>?\s*$/im.exec(raw)?.[1] ?? 'unknown').toLowerCase();
  const file = join(root, sender.replace(/[^a-z0-9@._-]/g, '_'), `${id}.eml`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, raw);
  bySender.set(sender, (bySender.get(sender) ?? 0) + 1);
}
console.log(`Saved ${Math.min(messages.length, max)} message(s) under ${root}:`);
for (const [sender, n] of [...bySender].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${sender}`);
await prisma.$disconnect();
