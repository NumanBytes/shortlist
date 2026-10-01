import { Global, Module } from '@nestjs/common';
import { JobQueues } from './job-queues.js';

@Global()
@Module({ providers: [JobQueues], exports: [JobQueues] })
export class QueueModule {}
