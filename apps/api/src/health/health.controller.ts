import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';

@Public() // load balancers and uptime checks call this without credentials
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
