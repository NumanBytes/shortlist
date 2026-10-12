import { Body, Controller, Get, Post } from '@nestjs/common';
import { ImportResumeSchema, type ImportResumeInput } from '@shortlist/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CareerImportService } from './career-import.service.js';

@Controller('career-import')
export class CareerImportController {
  constructor(private readonly imports: CareerImportService) {}

  @Post()
  start(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ImportResumeSchema)) body: ImportResumeInput) {
    return this.imports.start(user.id, body);
  }

  // The most recent import (or null), polled while one runs.
  @Get('latest')
  latest(@CurrentUser() user: AuthUser) {
    return this.imports.latest(user.id);
  }
}
