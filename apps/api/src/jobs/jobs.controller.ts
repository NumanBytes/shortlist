import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ListJobsQuerySchema,
  PasteDescriptionSchema,
  type PasteDescriptionInput,
  UpdateJobSchema,
  type ListJobsQuery,
  type UpdateJobInput,
} from '@shortlist/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { JobsService } from './jobs.service.js';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(ListJobsQuerySchema)) query: ListJobsQuery) {
    return this.jobs.list(user.id, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.get(user.id, id);
  }

  // 202: the worker does the work (and may defer it under the budget guard).
  @Post(':id/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  analyze(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.analyze(user.id, id);
  }

  @Post(':id/description')
  @HttpCode(HttpStatus.OK)
  pasteDescription(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(PasteDescriptionSchema)) body: PasteDescriptionInput,
  ) {
    return this.jobs.pasteDescription(user.id, id, body.description);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateJobSchema)) body: UpdateJobInput,
  ) {
    return this.jobs.update(user.id, id, body);
  }
}
