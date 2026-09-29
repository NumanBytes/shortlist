import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  LoginSchema,
  RefreshSchema,
  RegisterSchema,
  type LoginInput,
  type RefreshInput,
  type RegisterInput,
} from '@shortlist/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import { CurrentUser, type AuthUser } from './current-user.decorator.js';
import { Public } from './public.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body(new ZodValidationPipe(RegisterSchema)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK) // nothing is created, so 200 rather than Nest's POST default of 201
  login(@Body(new ZodValidationPipe(LoginSchema)) body: LoginInput) {
    return this.auth.login(body);
  }

  // Public: the access token has usually expired by the time a client calls this.
  // The refresh token in the body is the credential.
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodValidationPipe(RefreshSchema)) body: RefreshInput) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body(new ZodValidationPipe(RefreshSchema)) body: RefreshInput) {
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.findPublicUser(user.id);
  }
}
