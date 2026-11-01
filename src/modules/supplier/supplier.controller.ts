import {
  Body,
  Controller,
  Delete,
  Get,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { CreateSupplierDto } from './dto/create-supplier.dto';
import { QuerySupplierDto } from './dto/query-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
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
  @ApiBadRequestResponse({
    description: 'Invalid payload, including an invalid CNPJ',
  })
  @ApiConflictResponse({
    description: 'A supplier with this CNPJ already exists',
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

  @Get(':id')
  @ApiOperation({ summary: 'Find a supplier by id, including an inactive one' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SupplierEntity })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiNotFoundResponse({
    description:
      'Missing, deleted or another account supplier (SUPPLIER_NOT_FOUND)',
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.supplierService.findOne(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a supplier; active: true reactivates an inactive supplier',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SupplierEntity })
  @ApiBadRequestResponse({
    description:
      'The id is not a UUID or the payload is invalid, including an invalid CNPJ',
  })
  @ApiNotFoundResponse({
    description:
      'Missing, deleted or another account supplier (SUPPLIER_NOT_FOUND)',
  })
  @ApiConflictResponse({
    description: 'A supplier with this CNPJ already exists',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.supplierService.update(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Inactivate a supplier without deleting it',
    description:
      'Sets active to false and keeps the record readable by id, so linked orders retain their supplier. Idempotent.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SupplierEntity })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiNotFoundResponse({
    description:
      'Missing, deleted or another account supplier (SUPPLIER_NOT_FOUND)',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.supplierService.remove(id, user.id);
  }
}
