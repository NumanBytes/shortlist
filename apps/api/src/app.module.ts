import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SkillsModule } from './skills/skills.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, AuthModule, HealthModule, SkillsModule],
})
export class AppModule {}
