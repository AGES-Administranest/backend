import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CreateSupplierDto } from './dto/create-supplier.dto';
import { QuerySupplierDto } from './dto/query-supplier.dto';
import { SupplierEntity } from './entities/supplier.entity';
import { SupplierService } from './supplier.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('supplier')
@Controller('supplier')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new supplier' })
  @ApiCreatedResponse({ type: SupplierEntity })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiConflictResponse({
    description: 'A supplier with this name already exists',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSupplierDto,
  ) {
    return this.supplierService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: "Lists a user's suppliers: search by name, paginated",
  })
  @ApiOkResponse({ type: SupplierEntity, isArray: true })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QuerySupplierDto,
  ) {
    return this.supplierService.findAll(user.id, query);
  }
}
