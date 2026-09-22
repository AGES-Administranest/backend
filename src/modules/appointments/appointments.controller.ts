import {
  Body,
  Controller,
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
  ApiTags,
} from '@nestjs/swagger';

import { AppointmentsService } from './appointments.service';
import { CheckConflictQueryDto } from './dto/check-conflict-query.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import {
  AppointmentEntity,
  CheckConflictResultEntity,
} from './entities/appointment.entity';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('appointments')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Schedule a new appointment' })
  @ApiCreatedResponse({ type: AppointmentEntity })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiConflictResponse({
    description: 'The time slot conflicts with another scheduled appointment',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.appointmentsService.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit an appointment' })
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
}
