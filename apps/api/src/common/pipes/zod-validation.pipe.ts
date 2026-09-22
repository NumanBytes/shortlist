import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

// A pipe runs after routing and before your handler.
// In plain Express terms: middleware that validates req.body
// and either replaces it with clean data or ends the request with a 400.
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    // Return the PARSED value, not the original — it's trimmed and typed.
    return result.data;
  }
}
