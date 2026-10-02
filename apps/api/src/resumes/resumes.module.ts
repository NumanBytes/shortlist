import { Module } from '@nestjs/common';
import { ResumesController } from './resumes.controller.js';
import { ResumesService } from './resumes.service.js';

@Module({ controllers: [ResumesController], providers: [ResumesService] })
export class ResumesModule {}
