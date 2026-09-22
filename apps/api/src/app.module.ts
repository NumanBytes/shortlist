import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { SkillsModule } from './skills/skills.module.js';

@Module({
  imports: [HealthModule, SkillsModule],
})
export class AppModule {}
