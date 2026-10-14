import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Every route requires a valid access token unless it opts out with @Public().
// Secure by default: forgetting a decorator leaves a route locked, not open.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ALLOW_UNVERIFIED_KEY = 'allowUnverified';

// The few signed-in routes an account may use before verifying its email (docs/security.md
// §8.7): who am I, send the email again. Everything else is refused with 403 until then.
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED_KEY, true);
