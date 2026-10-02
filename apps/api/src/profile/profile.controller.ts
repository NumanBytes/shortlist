import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UpdateProfileSchema, type UpdateProfileInput } from '@shortlist/shared';
import { AuthService, PUBLIC_USER_SELECT } from '../auth/auth.service.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

// The signed-in user's own details — the resume header.
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.auth.findPublicUser(user.id);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(UpdateProfileSchema)) body: UpdateProfileInput) {
    return this.prisma.user.update({ where: { id: user.id }, data: body, select: PUBLIC_USER_SELECT });
  }
}
