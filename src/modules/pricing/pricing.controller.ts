import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { HourlyRateMonthParamsDto } from './dto/hourly-rate-month-params.dto';
import { QueryHourlyRateHistoryDto } from './dto/query-hourly-rate-history.dto';
import { QueryHourlyRateDto } from './dto/query-hourly-rate.dto';
import {
  HourlyRateHistoryItemResponse,
  HourlyRateHistoryMonthResponse,
} from './entities/hourly-rate-history.entity';
import { HourlyRateResponse } from './entities/hourly-rate.entity';
import { HourlyRateHistoryService } from './hourly-rate-history.service';
import { HourlyRateService } from './hourly-rate.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly hourlyRateService: HourlyRateService,
    private readonly historyService: HourlyRateHistoryService,
  ) {}

  @Get('hourly-rate')
  @ApiOperation({
    summary: "The value of the user's working hour for a month, part by part",
    description:
      'hourlyRate = (fixed costs + variable costs + owner draw + margin) ÷ ' +
      'productive hours, where margin = margin % × (fixed + variable + owner ' +
      'draw) and productive hours = weekly hours × 52 ÷ 12. Fixed costs are ' +
      'the personal expenses, the equipment depreciation and the transport ' +
      'cost of the month, as in GET /fixed-costs/summary; variable costs are ' +
      'the professional expenses (trips included). The owner draw, the margin ' +
      'and the weekly hours come from GET /pricing-settings. Without month and ' +
      'year, the current UTC month is used. Calculated on every request from ' +
      'the current goals. The result is then stored in the history (US22): ' +
      'the current month is replaced on every call, a past month is stored ' +
      'only if it has no snapshot yet, a future month is not stored.',
  })
  @ApiOkResponse({ type: HourlyRateResponse })
  @ApiBadRequestResponse({
    description: 'month or year is invalid (VALIDATION_ERROR)',
  })
  @ApiNotFoundResponse({
    description:
      'The income goal, weekly hours and margin were never saved ' +
      "(PRICING_SETTINGS_NOT_FOUND). The app shows the calculator's initial " +
      'state, as it does for GET /pricing-settings.',
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  getHourlyRate(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryHourlyRateDto,
  ): Promise<HourlyRateResponse> {
    return this.hourlyRateService.calculate(user.id, query);
  }

  @Get('hourly-rate/history')
  @ApiOperation({
    summary: 'The stored hour value of each month, latest first',
    description:
      'One item per month that has a snapshot, from the latest month back. ' +
      'A month gets one when GET /pricing/hourly-rate calculates it (the ' +
      'current month on every call, a past month only the first time) and ' +
      'when PUT /pricing-settings saves the goals (the current month). ' +
      'Months without one are left out, not answered as zero. from and to ' +
      'are inclusive and optional; without both, every stored month is ' +
      'listed. Amounts are decimal strings with 2 places.',
  })
  @ApiOkResponse({ type: HourlyRateHistoryItemResponse, isArray: true })
  @ApiBadRequestResponse({
    description:
      'from or to is not a YYYY-MM month with the year in 2000–2100, from is ' +
      'after to, or an unknown query parameter was sent (VALIDATION_ERROR)',
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  getHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryHourlyRateHistoryDto,
  ): Promise<HourlyRateHistoryItemResponse[]> {
    return this.historyService.list(user.id, query);
  }

  @Get('hourly-rate/history/:year/:month')
  @ApiOperation({
    summary: 'One stored month: its parts, shares and the goals it used',
    description:
      'The same shape as GET /pricing/hourly-rate, built from the stored ' +
      'snapshot and never recalculated: a later change to the goals or to the ' +
      "month's expenses does not show up here. parameters holds the income " +
      'goal, weekly hours and safety margin the month was calculated with. ' +
      'calculatedAt is when the stored calculation ran.',
  })
  @ApiOkResponse({ type: HourlyRateHistoryMonthResponse })
  @ApiBadRequestResponse({
    description:
      'year is not an integer in 2000–2100 or month is not an integer in ' +
      '1–12 (VALIDATION_ERROR)',
  })
  @ApiNotFoundResponse({
    description:
      'The month has no snapshot: never calculated, a future month, or a ' +
      'month of another account, which is not told apart (HOURLY_RATE_SNAPSHOT_NOT_FOUND). ' +
      'The app shows the month as empty.',
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  getHistoryMonth(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: HourlyRateMonthParamsDto,
  ): Promise<HourlyRateHistoryMonthResponse> {
    return this.historyService.findMonth(user.id, params);
  }
}
