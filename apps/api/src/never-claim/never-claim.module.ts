import { Module } from '@nestjs/common';
import { NeverClaimController } from './never-claim.controller.js';
import { NeverClaimService } from './never-claim.service.js';

@Module({ controllers: [NeverClaimController], providers: [NeverClaimService] })
export class NeverClaimModule {}
