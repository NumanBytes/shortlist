import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  CreateEducationSchema,
  UpdateEducationSchema,
  type CreateEducationInput,
  type UpdateEducationInput,
} from '@shortlist/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { EducationService } from './education.service.js';

@Controller('education')
export class EducationController {
  constructor(private readonly education: EducationService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.education.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(CreateEducationSchema)) body: CreateEducationInput) {
    return this.education.create(user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateEducationSchema)) body: UpdateEducationInput,
  ) {
    return this.education.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.education.remove(user.id, id);
  }
}
