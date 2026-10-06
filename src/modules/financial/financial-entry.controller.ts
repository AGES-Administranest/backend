import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { QueryFinancialEntryDto } from './dto/query-financial-entry.dto';
import { FinancialEntryResponse } from './entities/financial-entry.entity';
import { FinancialEntryService } from './financial-entry.service';
import { CurrentUser } from '../../shared/auth';
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('financial-entries')
@Controller('financial-entries')
export class FinancialEntryController {
  constructor(private readonly service: FinancialEntryService) {}

  @Get()
  @ApiOperation({
    summary: 'Lists the user statement for a month, newest accrual date first',
  })
  @ApiOkResponse({ type: FinancialEntryResponse, isArray: true })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryFinancialEntryDto,
  ) {
    return this.service.findAll(user.id, query);
  }
}
