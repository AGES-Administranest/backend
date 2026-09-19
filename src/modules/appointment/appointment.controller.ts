import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { AppointmentService } from './appointment.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentEntity } from './entities/appointment.entity';
import { CurrentUser } from '../../shared/auth';
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('appointments')
@Controller('appointments')
export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  @Post()
  @ApiOperation({ summary: 'Creates an appointment or procedure record' })
  @ApiCreatedResponse({ type: AppointmentEntity })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.appointmentService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lists appointments and procedures for the user' })
  @ApiOkResponse({ type: AppointmentEntity, isArray: true })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.appointmentService.findAll(user.id, page, limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Finds an appointment or procedure by id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AppointmentEntity })
  @ApiNotFoundResponse({ description: 'Appointment not found' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appointmentService.findOne(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially updates an appointment or procedure' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AppointmentEntity })
  @ApiNotFoundResponse({ description: 'Appointment not found' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return this.appointmentService.update(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft deletes an appointment or procedure' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Appointment not found' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appointmentService.remove(id, user.id);
  }
}