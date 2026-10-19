import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { QueryFixedCostsSummaryDto } from './dto/query-fixed-costs-summary.dto';
import { FixedCostsSummaryResponse } from './entities/fixed-costs-summary.entity';
import { FixedCostsService } from './fixed-costs.service';
import { CurrentUser } from '../../shared/auth';
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('fixed-costs')
@Controller('fixed-costs')
export class FixedCostsController {
  constructor(private readonly service: FixedCostsService) {}

  @Get('summary')
  @ApiOperation({
    summary: "Summarizes the user's fixed costs for a month",
    description:
      'Without month and year, the current UTC month is used, like the statement. Expenses follow the statement rule, so they match its Prof. and Personal cards. Depreciation is provisional until US15.',
  })
  @ApiOkResponse({ type: FixedCostsSummaryResponse })
  @ApiBadRequestResponse({
    description: 'A filter is invalid (VALIDATION_ERROR)',
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  getSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryFixedCostsSummaryDto,
  ): Promise<FixedCostsSummaryResponse> {
    return this.service.getSummary(user.id, query);
  }
}
