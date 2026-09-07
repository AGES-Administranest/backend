import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemRepository } from './item.repository';

@Injectable()
export class ItemService {
  constructor(private readonly itemRepository: ItemRepository) {}

  create(dto: CreateItemDto) {
    return this.itemRepository.create(dto);
  }

  findAll() {
    return this.itemRepository.findAll();
  }

  async findOne(id: string) {
    const item = await this.itemRepository.findOne(id);
    if (!item) {
      throw new NotFoundException(`Item ${id} não encontrado`);
    }
    return item;
  }

  async update(id: string, dto: UpdateItemDto) {
    await this.findOne(id);
    return this.itemRepository.update(id, dto);
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.itemRepository.softDelete(id);
  }
}