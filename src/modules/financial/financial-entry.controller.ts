import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseArrayPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { QueryFinancialEntryDto } from './dto/query-financial-entry.dto';
import { SyncFinancialEntryDto } from './dto/sync-financial-entry.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import {
  FinancialEntryResponse,
  FinancialEntrySyncResult,
} from './entities/financial-entry.entity';
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
    description:
      'Without month and year, the current UTC month is used. A page shorter than limit is the last page.',
  })
  @ApiOkResponse({ type: FinancialEntryResponse, isArray: true })
  @ApiBadRequestResponse({ description: 'A filter is invalid (VALIDATION_ERROR)' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryFinancialEntryDto,
  ) {
    return this.service.findAll(user.id, query);
  }

  @Post('sync')
  @ApiOperation({
    summary: 'Applies a batch of offline entry operations, oldest first',
    description:
      'Same shape as appointment sync: a JSON array. Each item returns applied, ignored (same id already stored), or conflict. A conflict on an automatic entry names FINANCIAL_ENTRY_CONTROLLED_BY_ORIGIN or FINANCIAL_ENTRY_DELETE_VIA_ORIGIN.',
  })
  @ApiOkResponse({ type: FinancialEntrySyncResult, isArray: true })
  @ApiBadRequestResponse({ description: 'The array is invalid (VALIDATION_ERROR)' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ParseArrayPipe({ items: SyncFinancialEntryDto }))
    operations: SyncFinancialEntryDto[],
  ) {
    return this.service.sync(user.id, operations);
  }

  @Post()
  @ApiOperation({
    summary: 'Creates a manual entry. Resending the same id returns it.',
  })
  @ApiCreatedResponse({ type: FinancialEntryResponse })
  @ApiBadRequestResponse({
    description:
      'Invalid amount, date, or payload (VALIDATION_ERROR), or the category is missing or has another nature (FINANCIAL_CATEGORY_INVALID)',
  })
  @ApiConflictResponse({
    description: 'This id belongs to another entry (FINANCIAL_ENTRY_ID_CONFLICT)',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFinancialEntryDto,
  ) {
    return this.service.create(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Returns one entry, including its origin',
    description:
      'origin.type is the source. origin.id is the linked record, or null when the entry is manual.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FinancialEntryResponse })
  @ApiBadRequestResponse({ description: 'id is not a UUID (VALIDATION_ERROR)' })
  @ApiNotFoundResponse({
    description: 'Missing, deleted, or another account (FINANCIAL_ENTRY_NOT_FOUND)',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Updates a manual entry, or description, category, scope and notes of an automatic one',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FinancialEntryResponse })
  @ApiBadRequestResponse({
    description:
      'Amount or accrual date of an automatic entry (FINANCIAL_ENTRY_CONTROLLED_BY_ORIGIN), or the category does not match (FINANCIAL_CATEGORY_INVALID)',
  })
  @ApiNotFoundResponse({
    description: 'Missing, deleted, or another account (FINANCIAL_ENTRY_NOT_FOUND)',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinancialEntryDto,
  ) {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-deletes a manual entry' })
  @ApiNoContentResponse()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiConflictResponse({
    description:
      'An automatic entry is removed only by deleting its origin (FINANCIAL_ENTRY_DELETE_VIA_ORIGIN). details.type and details.id name that origin.',
  })
  @ApiNotFoundResponse({
    description: 'Missing, deleted, or another account (FINANCIAL_ENTRY_NOT_FOUND)',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(user.id, id);
  }
}
