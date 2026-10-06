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
  ApiTags,
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
  })
  @ApiOkResponse({ type: FinancialEntryResponse, isArray: true })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryFinancialEntryDto,
  ) {
    return this.service.findAll(user.id, query);
  }

  @Post('sync')
  @ApiOperation({
    summary: 'Applies a batch of offline entry operations, oldest first',
  })
  @ApiOkResponse({ type: FinancialEntrySyncResult, isArray: true })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
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
  @ApiBadRequestResponse({ description: 'Invalid amount, date, or category' })
  @ApiConflictResponse({ description: 'This id belongs to another entry' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFinancialEntryDto,
  ) {
    return this.service.create(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Returns one entry, including its origin' })
  @ApiOkResponse({ type: FinancialEntryResponse })
  @ApiNotFoundResponse({ description: 'Entry was not found' })
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
  @ApiOkResponse({ type: FinancialEntryResponse })
  @ApiBadRequestResponse({
    description:
      'Amount or accrual date of an automatic entry, or the category does not match',
  })
  @ApiNotFoundResponse({ description: 'Entry was not found' })
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
  @ApiConflictResponse({
    description:
      'An automatic entry is removed only by deleting its origin. The body includes the origin type and id',
  })
  @ApiNotFoundResponse({ description: 'Entry was not found' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(user.id, id);
  }
}
