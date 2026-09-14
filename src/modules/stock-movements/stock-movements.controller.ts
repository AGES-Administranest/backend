import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { CreateStockCountDto } from './dto/create-stock-count.dto';
import { CreateStockPurchaseDto } from './dto/create-stock-purchase.dto';
import { QueryStockMovementDto } from './dto/query-stock-movement.dto';
import { StockBalanceReconciliationEntity } from './entities/stock-balance-reconciliation.entity';
import { StockMovementResultEntity } from './entities/stock-movement-result.entity';
import { StockMovementEntity } from './entities/stock-movement.entity';
import { StockMovementsService } from './stock-movements.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('stock-movement')
@Controller('stock-movement')
export class StockMovementsController {
  constructor(private readonly stockMovementsService: StockMovementsService) {}

  @Get()
  @ApiOperation({
    summary: 'Stock movement history — inbound, outbound and adjustments',
    description:
      'One list, newest first, ties broken by id. Filters are applied by the ' +
      'server: a page shorter than `limit` is the last one.',
  })
  @ApiOkResponse({ type: StockMovementEntity, isArray: true })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryStockMovementDto,
  ) {
    return this.stockMovementsService.findHistory(user.id, query);
  }

  @Post('adjustment')
  @ApiOperation({
    summary: 'Record a manual outbound adjustment (loss, expiry, breakage)',
    description:
      'Goes through the central ledger (OUTBOUND / MANUAL_ADJUSTMENT). Direction, ' +
      'origin, unit cost and timestamp are decided by the server — the client ' +
      'sends only what it knows. Blocked when it would leave the balance negative.',
  })
  @ApiCreatedResponse({ type: StockMovementResultEntity })
  @ApiNotFoundResponse({ description: 'Item not found' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiConflictResponse({
    description:
      'INSUFFICIENT_STOCK — the outbound does not fit in the balance. ' +
      '`details.available` carries what is left.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  registerAdjustment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStockAdjustmentDto,
  ) {
    return this.stockMovementsService.registerAdjustment(user.id, dto);
  }

  @Post('purchase')
  @ApiOperation({
    summary: 'Record a manual purchase entry',
    description:
      'For purchases with no order or invoice to import (over-the-counter). Goes ' +
      'through the central ledger (INBOUND / MANUAL_PURCHASE), sets the item unit ' +
      'cost to the price paid unless a more recent purchase already did, and ' +
      'reactivates the item if it was inactive.',
  })
  @ApiCreatedResponse({ type: StockMovementResultEntity })
  @ApiNotFoundResponse({ description: 'Item not found' })
  @ApiBadRequestResponse({ description: 'Invalid payload or a future date' })
  @ApiUnprocessableEntityResponse({ description: 'Supplier not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  registerPurchase(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStockPurchaseDto,
  ) {
    return this.stockMovementsService.registerPurchase(user.id, dto);
  }

  @Post('count')
  @ApiOperation({
    summary: 'Reconcile an item against a physical count',
    description:
      'The way out of needsAdjustment (US10). Writes the difference between the ' +
      'counted amount and the current balance as one more movement — the ledger ' +
      'is never edited — and clears the flag.',
  })
  @ApiCreatedResponse({ type: StockMovementResultEntity })
  @ApiNotFoundResponse({ description: 'Item not found' })
  @ApiBadRequestResponse({
    description: 'Invalid payload, or the count already matches the balance',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  registerCount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStockCountDto,
  ) {
    return this.stockMovementsService.registerCount(user.id, dto);
  }

  @Post('reconcile/:itemId')
  @HttpCode(200)
  @ApiOperation({
    summary: "Recompute an item's balance from its movement history",
    description:
      'Maintenance routine, not part of any user flow: sums the ledger and ' +
      'rewrites the cached balance if the two ever drift apart. Reading it is ' +
      'harmless — when nothing drifted it reports wasDivergent false and ' +
      'writes nothing.',
  })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiOkResponse({ type: StockBalanceReconciliationEntity })
  @ApiNotFoundResponse({ description: 'Item not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  reconcile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.stockMovementsService.reconcileItemBalance(user.id, itemId);
  }
}
