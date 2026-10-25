import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { QueryHourlyRateDto } from './dto/query-hourly-rate.dto';
import { HourlyRateResponse } from './entities/hourly-rate.entity';
import { HourlyRateService } from './hourly-rate.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  constructor(private readonly hourlyRateService: HourlyRateService) {}

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
      'year, the current UTC month is used. Calculated on every request, never stored.',
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
}
