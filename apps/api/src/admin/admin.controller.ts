import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  AddCatalogEntrySchema,
  SetAiBudgetSchema,
  UpdateCatalogEntrySchema,
  type AddCatalogEntryInput,
  type SetAiBudgetInput,
  type UpdateCatalogEntryInput,
} from '@shortlist/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CatalogService } from '../discovery/catalog.service.js';
import { AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly catalog: CatalogService,
  ) {}

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

  // The shared source catalog (docs/discovery.md §9.16).
  @Get('catalog')
  catalogEntries() {
    return this.catalog.all();
  }

  @Post('catalog')
  addCatalogEntry(@Body(new ZodValidationPipe(AddCatalogEntrySchema)) body: AddCatalogEntryInput) {
    return this.catalog.add(body);
  }

  @Patch('catalog/:id')
  updateCatalogEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateCatalogEntrySchema)) body: UpdateCatalogEntryInput,
  ) {
    return this.catalog.update(id, body);
  }

  @Delete('catalog/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCatalogEntry(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.remove(id);
  }
}
