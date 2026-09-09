import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemEntity } from './entities/item.entity';
import { ItemService } from './item.service';

@ApiTags('item')
@Controller('item')
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo item de estoque' })
  @ApiCreatedResponse({ type: ItemEntity })
  @ApiBadRequestResponse({ description: 'Payload inválido' })
  @ApiConflictResponse({
    description: 'Já existe um item com esse nome e essa unidade de medida',
  })
  @ApiUnprocessableEntityResponse({
    description: 'userId or supplierId does not match an existing record',
  })
  create(@Body() dto: CreateItemDto) {
    return this.itemService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lists active stock items' })
  @ApiOkResponse({ type: ItemEntity, isArray: true })
  findAll() {
    return this.itemService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Finds an item by id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ItemEntity })
  @ApiNotFoundResponse({ description: 'Item não encontrado' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.itemService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza parcialmente um item' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ItemEntity })
  @ApiBadRequestResponse({ description: 'Payload inválido' })
  @ApiNotFoundResponse({ description: 'Item não encontrado' })
  @ApiConflictResponse({
    description: 'Já existe um item com esse nome e essa unidade de medida',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateItemDto) {
    return this.itemService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Inativa um item (soft delete)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DeleteItemDto })
  @ApiNotFoundResponse({ description: 'Item não encontrado' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.itemService.remove(id);
  }
}
