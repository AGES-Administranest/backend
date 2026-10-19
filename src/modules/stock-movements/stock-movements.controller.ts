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
import { QueryStockSummaryDto } from './dto/query-stock-summary.dto';
import {
  QueryStockSyncDto,
  SyncStockMovementsDto,
} from './dto/sync-stock-movement.dto';
import { StockBalanceReconciliationEntity } from './entities/stock-balance-reconciliation.entity';
import { StockMovementResultEntity } from './entities/stock-movement-result.entity';
import { StockMovementEntity } from './entities/stock-movement.entity';
import { StockSummaryEntity } from './entities/stock-summary.entity';
import {
  StockSyncPullEntity,
  StockSyncPushEntity,
} from './entities/stock-sync.entity';
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

  @Get('summary')
  @ApiOperation({
    summary: 'What moved over a period, and what it was worth',
    description:
      'Totals in and out, consumption grouped by procedure, adjustments grouped ' +
      'by reason, and the value of each block. Naming an item adds the balance ' +
      'it opened the period with and the one it closed with — computed from the ' +
      'movements before the period, not from the balance it carries today.',
  })
  @ApiOkResponse({ type: StockSummaryEntity })
  @ApiBadRequestResponse({ description: 'Missing or inverted period' })
  @ApiNotFoundResponse({ description: 'Item not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryStockSummaryDto,
  ) {
    return this.stockMovementsService.buildSummary(user.id, query);
  }

  @Get('sync')
  @ApiOperation({
    summary: 'Delta of everything written to the ledger since a cursor',
    description:
      'For a device coming back online. Answers with the movements plus the ' +
      'current balance of every item they touched, so the app does not have to ' +
      'replay its local history to know where it stands. The cursor it returns ' +
      'is what the next pull should send.',
  })
  @ApiOkResponse({ type: StockSyncPullEntity })
  @ApiBadRequestResponse({ description: 'Missing or malformed cursor' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  syncPull(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryStockSyncDto,
  ) {
    return this.stockMovementsService.syncPull(user.id, query);
  }

  @Post('sync')
  @ApiOperation({
    summary: 'Push a batch of movements recorded while offline',
    description:
      'Idempotent by the device-generated id (ADR-09): re-sending a batch that ' +
      'was half delivered applies only what is missing. Movements are applied ' +
      'in occurredAt order, not arrival order, and one that would leave the ' +
      'balance negative is kept — the consumption did happen — with the item ' +
      'flagged for a count.',
  })
  @ApiCreatedResponse({ type: StockSyncPushEntity })
  @ApiBadRequestResponse({
    description:
      'Invalid payload, empty batch, or an origin that cannot exist offline',
  })
  @ApiNotFoundResponse({
    description: 'An item in the batch does not exist yet — sync items first',
  })
  @ApiConflictResponse({
    description: 'A movement id already belongs to another account',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  syncPush(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SyncStockMovementsDto,
  ) {
    return this.stockMovementsService.syncPush(user.id, dto);
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
  @ApiConflictResponse({
    description:
      'STOCK_BALANCE_CHANGED — the item kept moving while the count was recorded',
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
