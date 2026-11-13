import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { QueryGeneralReportDto } from './dto/query-general-report.dto';
import { QueryReportsAvailabilityDto } from './dto/query-reports-availability.dto';
import {
  GeneralReportEntity,
  SECTION_MODELS,
} from './entities/general-report.entity';
import { ReportsAvailabilityEntity } from './entities/reports-availability.entity';
import { GeneralReportService } from './general-report.service';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('reports')
@ApiExtraModels(...Object.values(SECTION_MODELS))
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly generalReport: GeneralReportService,
  ) {}

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

  @Get('general')
  @ApiOperation({
    summary: 'The general report of a period (US29)',
    description:
      'The selected sections of the period, in the order of the document. Feeds the preview (US27) and the PDF (US28). Both dates are included; deleted records are not counted. At most 366 days. A selected section without records is still sent, with `empty: true`. Read-only: a month without a stored hourly rate is calculated for the answer and not stored (US22).',
  })
  @ApiOkResponse({ type: GeneralReportEntity })
  @ApiBadRequestResponse({
    description:
      'A date is missing or not YYYY-MM-DD, or a section is unknown (VALIDATION_ERROR); `from` is after `to` (REPORT_PERIOD_INVALID); the period is longer than 366 days (REPORT_PERIOD_TOO_LONG); `sections` is present but empty (REPORT_SECTIONS_EMPTY)',
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  getGeneral(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryGeneralReportDto,
  ): Promise<GeneralReportEntity> {
    return this.generalReport.generate(user.id, query);
  }
}
