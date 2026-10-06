import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
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

  @Patch(':id')
  @ApiOperation({ summary: 'Updates a manual entry' })
  @ApiOkResponse({ type: FinancialEntryResponse })
  @ApiBadRequestResponse({
    description: 'The entry is automatic, or the category does not match',
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
  @ApiBadRequestResponse({ description: 'The entry is automatic' })
  @ApiNotFoundResponse({ description: 'Entry was not found' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(user.id, id);
  }
}
