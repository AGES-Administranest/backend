import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { QueryReportsAvailabilityDto } from './dto/query-reports-availability.dto';
import { TaxPackagePeriodDto } from './dto/tax-package-period.dto';
import { ReportsAvailabilityEntity } from './entities/reports-availability.entity';
import { TaxPackageExportEntity } from './entities/tax-package-export.entity';
import { TaxPackageSummaryEntity } from './entities/tax-package-summary.entity';
import { ReportsService } from './reports.service';
import { TaxPackageService } from './tax-package.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly taxPackageService: TaxPackageService,
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

  @Get('tax-package/summary')
  @ApiOperation({
    summary: 'What the tax package of the period would hold',
    description:
      'Confirmed service invoices (by issue date) and purchase invoices that have their file in storage. Those without a file are only counted in `missingFiles`. Both dates are included.',
  })
  @ApiOkResponse({ type: TaxPackageSummaryEntity })
  @ApiBadRequestResponse({
    description:
      'A date is missing or not YYYY-MM-DD, or `from` is after `to` (REPORT_PERIOD_INVALID)',
  })
  getTaxPackageSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TaxPackagePeriodDto,
  ) {
    return this.taxPackageService.getSummary(user.id, query);
  }

  // Builds a zip inside the request, so it gets a tighter ceiling than the
  // rest of the API.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('tax-package')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Zip of the period documents, ready to download',
    description:
      'Packs the same documents the summary counts into one zip, stores it and answers with a download URL. Files that vanished from storage meanwhile are left out and listed in `skipped`.',
  })
  @ApiOkResponse({ type: TaxPackageExportEntity })
  @ApiBadRequestResponse({
    description: 'Invalid dates (REPORT_PERIOD_INVALID)',
  })
  @ApiNotFoundResponse({
    description: 'No document with a file in the period (TAX_PACKAGE_EMPTY)',
  })
  @ApiPayloadTooLargeResponse({
    description:
      'More documents or bytes than one package holds (TAX_PACKAGE_TOO_LARGE)',
  })
  generateTaxPackage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TaxPackagePeriodDto,
  ) {
    return this.taxPackageService.generate(user.id, body);
  }
}
