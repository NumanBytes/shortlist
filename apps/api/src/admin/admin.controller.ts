import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { SetAiBudgetSchema, type SetAiBudgetInput } from '@shortlist/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  users() {
    return this.admin.users();
  }

  @Put('users/:id/ai-budget')
  setBudget(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(SetAiBudgetSchema)) body: SetAiBudgetInput,
  ) {
    return this.admin.setBudget(id, body.monthlyBudgetUsd);
  }
}
