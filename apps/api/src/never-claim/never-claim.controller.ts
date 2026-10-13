import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateNeverClaimSchema, type CreateNeverClaimInput } from '@shortlist/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { NeverClaimService } from './never-claim.service.js';

@Controller('never-claim')
export class NeverClaimController {
  constructor(private readonly neverClaim: NeverClaimService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.neverClaim.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateNeverClaimSchema)) body: CreateNeverClaimInput,
  ) {
    return this.neverClaim.create(user.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.neverClaim.remove(user.id, id);
  }
}
