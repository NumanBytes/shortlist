import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProfileController } from './profile.controller.js';

@Module({ imports: [AuthModule], controllers: [ProfileController] })
export class ProfileModule {}
