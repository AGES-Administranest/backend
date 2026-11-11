import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { QueryReportsAvailabilityDto } from './dto/query-reports-availability.dto';
import { ReportsAvailabilityEntity } from './entities/reports-availability.entity';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('availability')
  @ApiOperation({
    summary: 'How many records the period has in each report section',
    description:
      'Asked before generating a report, so the app can tell the user the period is empty. Both dates are included; deleted records are not counted.',
  })
  @ApiOkResponse({ type: ReportsAvailabilityEntity })
  @ApiBadRequestResponse({
    description:
      'A date is missing or not YYYY-MM-DD, or `from` is after `to` (REPORT_PERIOD_INVALID)',
  })
  getAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryReportsAvailabilityDto,
  ) {
    return this.reportsService.getAvailability(user.id, query);
  }
}
