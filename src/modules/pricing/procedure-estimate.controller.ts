import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { ProcedureEstimateDto } from './dto/procedure-estimate.dto';
import { ProcedureEstimateResponse } from './entities/procedure-estimate.entity';
import { ProcedureEstimateService } from './procedure-estimate.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

// A controller of its own under /pricing, beside the hourly-rate one, so each
// route's documentation and dependencies stay apart.
@Controller('pricing')
export class ProcedureEstimateController {
  constructor(
    private readonly procedureEstimateService: ProcedureEstimateService,
  ) {}

  /** A simulation: nothing is stored, so it answers 200, not 201. */
  @Post('procedure-estimate')
  @HttpCode(HttpStatus.OK)
  estimate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ProcedureEstimateDto,
  ): Promise<ProcedureEstimateResponse> {
    return this.procedureEstimateService.estimate(user.id, dto);
  }
}
