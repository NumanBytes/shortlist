import { Global, Module } from '@nestjs/common';
import { loadEnv } from './env.js';

// Injection token for the validated environment. Services ask for `@Inject(ENV)`
// instead of reading process.env directly, so every value they see has passed the schema.
export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
