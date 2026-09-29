import { Module } from '@nestjs/common';
import { WorkExperienceController } from './work-experience.controller.js';
import { WorkExperienceService } from './work-experience.service.js';

@Module({
  controllers: [WorkExperienceController],
  providers: [WorkExperienceService],
})
export class WorkExperienceModule {}
