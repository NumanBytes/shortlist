import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { EvidenceModule } from './evidence/evidence.module.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { SkillsModule } from './skills/skills.module.js';
import { WorkExperienceModule } from './work-experience/work-experience.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    HealthModule,
    SkillsModule,
    EvidenceModule,
    WorkExperienceModule,
    ProjectsModule,
  ],
})
export class AppModule {}
