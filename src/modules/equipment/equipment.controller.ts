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
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { QueryEquipmentDto } from './dto/query-equipment.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';
import { EquipmentSummaryEntity } from './entities/equipment-summary.entity';
import { EquipmentEntity } from './entities/equipment.entity';
import { EquipmentService } from './equipment.service';
import { CurrentUser } from '../../shared/auth';
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('equipment')
@Controller('equipment')
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @Post()
  @ApiOperation({ summary: 'Register equipment' })
  @ApiCreatedResponse({ type: EquipmentEntity })
  @ApiBadRequestResponse({ description: 'Invalid equipment data' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEquipmentDto,
  ) {
    return this.equipmentService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: "Lists the user's equipment" })
  @ApiOkResponse({ type: EquipmentEntity, isArray: true })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryEquipmentDto,
  ) {
    return this.equipmentService.findAll(user.id, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Summarize depreciation of active equipment' })
  @ApiOkResponse({ type: EquipmentSummaryEntity })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.equipmentService.summary(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Find equipment by id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EquipmentEntity })
  @ApiNotFoundResponse({ description: 'Equipment not found' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.equipmentService.findOne(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update equipment' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EquipmentEntity })
  @ApiBadRequestResponse({ description: 'Invalid equipment data' })
  @ApiNotFoundResponse({ description: 'Equipment not found' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEquipmentDto,
  ) {
    return this.equipmentService.update(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate equipment' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EquipmentEntity })
  @ApiNotFoundResponse({ description: 'Equipment not found' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.equipmentService.remove(id, user.id);
  }
}
