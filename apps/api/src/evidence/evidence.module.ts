import { Module } from '@nestjs/common';
import { EvidenceController } from './evidence.controller.js';
import { EvidenceService } from './evidence.service.js';

@Module({
  controllers: [EvidenceController],
  providers: [EvidenceService],
})
export class EvidenceModule {}
