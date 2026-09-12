import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { QueryStockHistoryDto } from './dto/query-stock-history.dto';
import { StockPeriodFilterDto } from './dto/stock-period-filter.dto';
import { StockHistoryPageEntity } from './entities/stock-history-page.entity';
import { StockSummaryEntity } from './entities/stock-summary.entity';
import { StockHistoryService } from './stock-history.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('stock-movements')
@Controller('stock-movements')
export class StockHistoryController {
  constructor(private readonly stockHistoryService: StockHistoryService) {}

  @Get()
  @ApiOperation({
    summary: 'Lists the stock movement history, newest first',
    description:
      'Each movement comes with its origin resolved: patient and procedure ' +
      'for an appointment, order number and supplier for an order import, ' +
      'reason for a manual adjustment. Filters combine freely; all optional.',
  })
  @ApiOkResponse({ type: StockHistoryPageEntity })
  @ApiBadRequestResponse({ description: 'Invalid filter or pagination' })
  @ApiNotFoundResponse({ description: 'itemId does not belong to the user' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryStockHistoryDto,
  ): Promise<StockHistoryPageEntity> {
    return this.stockHistoryService.listHistory(user, query);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Consolidated consumption of a period, with money values',
    description:
      'Inbound and outbound totals, consumption by procedure and adjustments ' +
      'by reason (expiration losses included). With itemId, also the item ' +
      'balance: opening (from the ledger before the period), inbound, ' +
      'outbound and closing.',
  })
  @ApiOkResponse({ type: StockSummaryEntity })
  @ApiBadRequestResponse({ description: 'Invalid filter' })
  @ApiNotFoundResponse({ description: 'itemId does not belong to the user' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  summarize(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: StockPeriodFilterDto,
  ): Promise<StockSummaryEntity> {
    return this.stockHistoryService.summarize(user, query);
  }
}
