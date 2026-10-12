import { Module } from '@nestjs/common';
import { CareerImportController } from './career-import.controller.js';
import { CareerImportService } from './career-import.service.js';

@Module({ controllers: [CareerImportController], providers: [CareerImportService] })
export class CareerImportModule {}
