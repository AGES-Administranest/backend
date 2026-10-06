import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

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
  })
  @ApiOkResponse({ type: FinancialCategoryResponse, isArray: true })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryFinancialCategoryDto,
  ) {
    return this.service.findAll(user.id, query);
  }
}
