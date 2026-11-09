import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { QuerySupplierInvoicesDto } from './dto/query-supplier-invoices.dto';
import { SupplierInvoiceSummaryDto } from './dto/supplier-invoice-summary.dto';
import { StockEntryService } from './stock-entry.service';
import { CurrentUser } from '../../shared/auth';
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('supplier')
@Controller('supplier/:supplierId/purchase-invoices')
export class SupplierInvoicesController {
  constructor(private readonly stockEntryService: StockEntryService) {}

  @Get()
  @ApiOperation({
    summary: "Lists a supplier's confirmed purchase invoices, newest first",
  })
  @ApiParam({ name: 'supplierId', format: 'uuid' })
  @ApiOkResponse({ type: SupplierInvoiceSummaryDto, isArray: true })
  @ApiBadRequestResponse({
    description: 'The supplier id, date range or pagination is invalid',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({
    description: 'The supplier is missing, deleted or belongs to another user',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Query() query: QuerySupplierInvoicesDto,
  ): Promise<SupplierInvoiceSummaryDto[]> {
    return this.stockEntryService.listSupplierInvoices(
      user.id,
      supplierId,
      query,
    );
  }
}
