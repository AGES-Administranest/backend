import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { QueryFinancialBalanceDto } from './dto/query-financial-balance.dto';
import { FinancialBalanceResponse } from './entities/financial-balance.entity';
import { FinancialEntryService } from './financial-entry.service';
import { CurrentUser } from '../../shared/auth';
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('financial-balance')
@Controller('financial-balance')
export class FinancialBalanceController {
  constructor(private readonly service: FinancialEntryService) {}

  @Get()
  @ApiOperation({
    summary: "Summarizes the user's income and expenses for a month",
    description:
      'Without month and year, the current UTC month is used, like the statement. Expenses follow the statement rule. The equipment depreciation (US15) is added as a professional expense and as the DEPRECIATION group; it is computed, not stored, so it is not in the statement.',
  })
  @ApiOkResponse({ type: FinancialBalanceResponse })
  @ApiBadRequestResponse({
    description: 'A filter is invalid (VALIDATION_ERROR)',
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  getBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryFinancialBalanceDto,
  ): Promise<FinancialBalanceResponse> {
    return this.service.getBalance(user.id, query);
  }
}
