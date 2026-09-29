import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Every route requires a valid access token unless it opts out with @Public().
// Secure by default: forgetting a decorator leaves a route locked, not open.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
