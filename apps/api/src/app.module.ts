import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { DiscoveryModule } from './discovery/discovery.module.js';
import { EducationModule } from './education/education.module.js';
import { NeverClaimModule } from './never-claim/never-claim.module.js';
import { EvidenceModule } from './evidence/evidence.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { GmailModule } from './gmail/gmail.module.js';
import { ResumesModule } from './resumes/resumes.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { QueueModule } from './queue/queue.module.js';
import { SkillsModule } from './skills/skills.module.js';
import { WorkExperienceModule } from './work-experience/work-experience.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    QueueModule,
    AuthModule,
    HealthModule,
    SkillsModule,
    EvidenceModule,
    WorkExperienceModule,
    ProjectsModule,
    JobsModule,
    DiscoveryModule,
    AiModule,
    ProfileModule,
    ResumesModule,
    GmailModule,
    EducationModule,
    NeverClaimModule,
  ],
})
export class AppModule {}
