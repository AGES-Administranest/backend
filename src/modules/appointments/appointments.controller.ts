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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { AppointmentsService } from './appointments.service';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { CheckConflictQueryDto } from './dto/check-conflict-query.dto';
import { CompleteAppointmentDto } from './dto/complete-appointment.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { EditAppointmentItemDto } from './dto/edit-appointment-item.dto';
import { QueryAppointmentDto } from './dto/query-appointment.dto';
import { RegisterAppointmentItemsDto } from './dto/register-appointment-items.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import {
  EditAppointmentItemResultEntity,
  RegisterAppointmentItemsResultEntity,
  RemoveAppointmentItemResultEntity,
} from './entities/appointment-items.entity';
import {
  AppointmentEntity,
  CheckConflictResultEntity,
  CompletedAppointmentEntity,
} from './entities/appointment.entity';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('appointments')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an appointment or procedure' })
  @ApiCreatedResponse({ type: AppointmentEntity })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiConflictResponse({
    description: 'The time slot conflicts with another scheduled appointment',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAppointmentDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.appointmentsService
      .createWithResult(user.id, dto)
      .then(result => {
        response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
        return result.appointment;
      });
  }

  @Post('sync')
  @ApiOperation({
    summary: 'Synchronize appointments created or edited offline',
  })
  @ApiOkResponse({ type: AppointmentEntity, isArray: true })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ParseArrayPipe({ items: CreateAppointmentDto }))
    appointments: CreateAppointmentDto[],
  ) {
    return this.appointmentsService.sync(user.id, appointments);
  }

  @Post(':id/items')
  @ApiOperation({
    summary:
      'Registers the supplies used in an appointment, deducting them from stock',
    description:
      'Creates one OUTBOUND stock movement per line. Insufficient stock does not block the registration: the item goes negative and the response lists it under `warnings` as `insufficient_stock`.',
  })
  @ApiCreatedResponse({ type: RegisterAppointmentItemsResultEntity })
  @ApiBadRequestResponse({
    description:
      'Invalid payload, or an item with no lot and no defaultUnitCost to cost it',
  })
  @ApiNotFoundResponse({ description: 'Appointment or item not found' })
  @ApiConflictResponse({
    description:
      'The appointment is canceled, or a clientGeneratedId was already used for a different line',
  })
  registerItems(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegisterAppointmentItemsDto,
  ) {
    return this.appointmentsService.registerItems(id, user.id, dto);
  }

  @Patch(':id/items/:movementId')
  @ApiOperation({
    summary: 'Corrects the quantity of a supply saved in an appointment',
    description:
      'Stock movements are never edited: the supply is reversed (CORRECTION_REVERSAL) and a new OUTBOUND movement records the new quantity, at the same lot, cost and date. The new movement replaces the supply — use its id from then on. Resending with the same `clientGeneratedId` returns that movement instead of correcting the stock again.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({
    name: 'movementId',
    format: 'uuid',
    description: 'The OUTBOUND movement of the supply',
  })
  @ApiOkResponse({ type: EditAppointmentItemResultEntity })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiNotFoundResponse({
    description:
      'Appointment not found, or the movement is not one of its supplies',
  })
  @ApiConflictResponse({
    description:
      'The appointment is canceled, the supply was already corrected, or the clientGeneratedId was already used for something else',
  })
  editItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('movementId', ParseUUIDPipe) movementId: string,
    @Body() dto: EditAppointmentItemDto,
  ) {
    return this.appointmentsService.editItem(id, movementId, user.id, dto);
  }

  @Delete(':id/items/:movementId')
  @ApiOperation({
    summary: 'Removes a supply saved in an appointment, giving the stock back',
    description:
      'Records a CORRECTION_REVERSAL of the supply. Idempotent: removing a supply that was already reversed returns that reversal and changes nothing.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({
    name: 'movementId',
    format: 'uuid',
    description: 'The OUTBOUND movement of the supply',
  })
  @ApiOkResponse({ type: RemoveAppointmentItemResultEntity })
  @ApiNotFoundResponse({
    description:
      'Appointment not found, or the movement is not one of its supplies',
  })
  @ApiConflictResponse({ description: 'The appointment is canceled' })
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('movementId', ParseUUIDPipe) movementId: string,
  ) {
    return this.appointmentsService.removeItem(id, movementId, user.id);
  }

  @Get('check-conflict')
  @ApiOperation({
    summary:
      'Checks whether a time slot conflicts with another scheduled appointment, without creating or editing anything',
  })
  @ApiOkResponse({ type: CheckConflictResultEntity })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  checkConflict(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CheckConflictQueryDto,
  ) {
    return this.appointmentsService.checkConflict(
      user.id,
      new Date(query.startsAt),
      new Date(query.endsAt),
      query.excludeId,
    );
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
  @ApiConflictResponse({
    description: 'The time slot conflicts with another scheduled appointment',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return this.appointmentsService.update(id, user.id, dto);
  }

  @Patch(':id/complete')
  @ApiOperation({
    summary: 'Mark a scheduled appointment as performed and post its revenue',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CompletedAppointmentEntity })
  @ApiBadRequestResponse({
    description:
      'Invalid payload, or no amount in the body nor on the appointment',
  })
  @ApiNotFoundResponse({ description: 'Appointment not found' })
  @ApiConflictResponse({ description: 'Appointment is not SCHEDULED' })
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteAppointmentDto,
  ) {
    return this.appointmentsService.complete(id, user.id, dto);
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary: 'Mark a scheduled appointment as not performed',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AppointmentEntity })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiNotFoundResponse({ description: 'Appointment not found' })
  @ApiConflictResponse({ description: 'Appointment is not SCHEDULED' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
  ) {
    return this.appointmentsService.cancel(id, user.id, dto);
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
