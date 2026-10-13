// Prints a new VAPID key pair for Web Push (docs/notifications.md §19):
//   pnpm --filter @shortlist/worker vapid:keys
// Put both in the worker's env and the public key in the API's. Keep the pair once devices
// have subscribed: changing it makes every device turn notifications on again.
import { generateVapidKeys } from '@shortlist/shared/node';

const keys = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
