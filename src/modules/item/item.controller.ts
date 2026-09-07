import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CreateItemDto } from './dto/create-item.dto';
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
  @ApiConflictResponse({ description: 'Item já cadastrado' })
  create(@Body() dto: CreateItemDto) {
    return this.itemService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista os itens de estoque ativos' })
  @ApiOkResponse({ type: ItemEntity, isArray: true })
  findAll() {
    return this.itemService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um item pelo id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ItemEntity })
  @ApiNotFoundResponse({ description: 'Item não encontrado' })
  findOne(@Param('id') id: string) {
    return this.itemService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um item' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ItemEntity })
  @ApiNotFoundResponse({ description: 'Item não encontrado' })
  update(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.itemService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Inativa um item (soft delete)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Item não encontrado' })
  remove(@Param('id') id: string) {
    return this.itemService.remove(id);
  }
}