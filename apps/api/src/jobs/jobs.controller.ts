import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import {
  ListJobsQuerySchema,
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

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateJobSchema)) body: UpdateJobInput,
  ) {
    return this.jobs.update(user.id, id, body);
  }
}
