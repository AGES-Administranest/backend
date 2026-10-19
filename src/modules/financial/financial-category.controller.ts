import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

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
      'Defaults have no user. Pass nature=INCOME or nature=EXPENSE to filter. Inactive categories are omitted.',
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
}
