import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseArrayPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
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
import type { Response } from 'express';

import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { QueryAppointmentDto } from './dto/query-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentEntity } from './entities/appointment.entity';
import { CurrentUser } from '../../shared/auth';
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('appointments')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an appointment or procedure' })
  @ApiCreatedResponse({ type: AppointmentEntity })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAppointmentDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.appointmentsService.createWithResult(user.id, dto).then(result => {
      response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
      return result.appointment;
    });
  }

  @Post('sync')
  @ApiOperation({ summary: 'Synchronize appointments created or edited offline' })
  @ApiOkResponse({ type: AppointmentEntity, isArray: true })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ParseArrayPipe({ items: CreateAppointmentDto }))
    appointments: CreateAppointmentDto[],
  ) {
    return this.appointmentsService.sync(user.id, appointments);
  }

  @Get()
  @ApiOperation({ summary: 'List appointments and procedures by date' })
  @ApiOkResponse({ type: AppointmentEntity, isArray: true })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryAppointmentDto,
  ) {
    return this.appointmentsService.findAll(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Find an appointment or procedure by id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AppointmentEntity })
  @ApiNotFoundResponse({ description: 'Appointment not found' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appointmentsService.findOne(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update an appointment or procedure' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AppointmentEntity })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiNotFoundResponse({ description: 'Appointment not found' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return this.appointmentsService.update(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete an appointment or procedure' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AppointmentEntity })
  @ApiNotFoundResponse({ description: 'Appointment not found' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appointmentsService.remove(id, user.id);
  }
}
