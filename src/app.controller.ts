import { Controller, Get } from '@nestjs/common';

import { AppService } from './app.service';
import { Public } from './shared/auth';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Open: it carries no data and stands in as a liveness check until /health exists. */
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
