import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PrepareResumeSchema, type PrepareResumeInput } from '@shortlist/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ResumesService } from './resumes.service.js';

@Controller()
export class ResumesController {
  constructor(private readonly resumes: ResumesService) {}

  @Get('resumes/active')
  active(@CurrentUser() user: AuthUser) {
    return this.resumes.active(user.id);
  }

  @Get('jobs/:id/resume')
  forJob(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.resumes.forJob(user.id, id);
  }

  // 202: tailoring happens in the worker. Reuse completes immediately but answers the same way.
  @Post('jobs/:id/resume')
  @HttpCode(HttpStatus.ACCEPTED)
  prepare(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(PrepareResumeSchema)) body: PrepareResumeInput,
  ) {
    return this.resumes.prepare(user.id, id, body);
  }

  @Post('resumes/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.resumes.approve(user.id, id);
  }
}
