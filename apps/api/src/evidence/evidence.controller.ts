import { Body, Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  CreateSkillEvidenceSchema,
  UpdateSkillEvidenceSchema,
  type CreateSkillEvidenceInput,
  type UpdateSkillEvidenceInput,
} from '@shortlist/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { EvidenceService } from './evidence.service.js';

// Evidence is listed through GET /skills (nested under its skill), so there is no
// separate list endpoint here.
@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateSkillEvidenceSchema)) body: CreateSkillEvidenceInput,
  ) {
    return this.evidence.create(user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateSkillEvidenceSchema)) body: UpdateSkillEvidenceInput,
  ) {
    return this.evidence.update(user.id, id, body);
  }

  // Verification is its own endpoint rather than a field on PATCH: it's a distinct,
  // deliberate act, and keeping it separate means no request body can ever carry it.
  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  verify(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.evidence.verify(user.id, id);
  }

  @Post(':id/unverify')
  @HttpCode(HttpStatus.OK)
  unverify(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.evidence.unverify(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.evidence.remove(user.id, id);
  }
}
