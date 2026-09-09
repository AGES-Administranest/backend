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
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CreateItemDto } from './dto/create-item.dto';
import { DeleteItemDto } from './dto/delete-item.dto';
import { QueryItemDto } from './dto/query-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemEntity } from './entities/item.entity';
import { ItemService } from './item.service';

@ApiTags('item')
@Controller('item')
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new inventory item' })
  @ApiCreatedResponse({ type: ItemEntity })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiConflictResponse({
    description: 'An item with this name and measurement unit already exists',
  })
  @ApiUnprocessableEntityResponse({
    description: 'userId or supplierId does not match an existing record',
  })
  create(@Body() dto: CreateItemDto) {
    return this.itemService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'Lists stock items for a user: search by name, filter by category, paginated',
  })
  @ApiOkResponse({ type: ItemEntity, isArray: true })
  findAll(@Query() query: QueryItemDto) {
    return this.itemService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Finds an item by id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ItemEntity })
  @ApiNotFoundResponse({ description: 'Item not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.itemService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update an item' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ItemEntity })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiNotFoundResponse({ description: 'Item not found' })
  @ApiConflictResponse({
    description: 'An item with this name and measurement unit already exists',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateItemDto) {
    return this.itemService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate an item (soft delete)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DeleteItemDto })
  @ApiNotFoundResponse({ description: 'Item not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.itemService.remove(id);
  }
}
