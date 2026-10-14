import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CreateFinancialCategoryDto } from './dto/create-financial-category.dto';
import { QueryFinancialCategoryDto } from './dto/query-financial-category.dto';
import { FinancialCategoryResponse } from './entities/financial-category.entity';
import { FinancialCategoryService } from './financial-category.service';
import { CurrentUser } from '../../shared/auth';
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('financial-categories')
@Controller('financial-categories')
export class FinancialCategoryController {
  constructor(private readonly service: FinancialCategoryService) {}

  @Get()
  @ApiOperation({
    summary: 'Lists active default categories and the user categories',
    description:
      'Defaults are shared by every user and come with isDefault true; the user categories come with isDefault false. The owner is never returned. Pass nature=INCOME or nature=EXPENSE to filter. Inactive categories are omitted.',
  })
  @ApiOkResponse({ type: FinancialCategoryResponse, isArray: true })
  @ApiBadRequestResponse({
    description: 'nature is not INCOME or EXPENSE (VALIDATION_ERROR)',
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryFinancialCategoryDto,
  ) {
    return this.service.findAll(user.id, query);
  }

  @Post()
  @ApiOperation({
    summary:
      'Creates a category of the user. Resending the same id returns it.',
    description:
      'The owner is always the caller. The name is compared with the user categories and the defaults of the same nature, ignoring case, accents and extra spaces. Defaults are compared by their stored English names: "Outros" does not match the default "Other".',
  })
  @ApiCreatedResponse({ type: FinancialCategoryResponse })
  @ApiBadRequestResponse({
    description:
      'Invalid id, name (empty or over 40 characters), nature or defaultScope, or an unknown field such as userId (VALIDATION_ERROR)',
  })
  @ApiConflictResponse({
    description:
      'The name is already used in this nature (FINANCIAL_CATEGORY_DUPLICATED, details.id is the category to select), or the id belongs to another category (FINANCIAL_CATEGORY_ID_CONFLICT)',
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFinancialCategoryDto,
  ) {
    return this.service.create(user.id, dto);
  }
}
