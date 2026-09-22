import { Body, Controller, Post } from '@nestjs/common';
import { CreateSkillSchema, type CreateSkillInput } from '@shortlist/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

// Temporary: echoes validated input so you can see the pipe working.
// Step 2 replaces this with a service that writes to Postgres via Prisma.
@Controller('skills')
export class SkillsController {
  @Post()
  create(@Body(new ZodValidationPipe(CreateSkillSchema)) body: CreateSkillInput) {
    return { received: body };
  }
}
