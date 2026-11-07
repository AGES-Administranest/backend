import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
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

import { ClientEntity } from './client.entity';
import { ClientService } from './client.service';
import { CreateClientDto } from './dto/create-client.dto';
import { DeleteClientDto } from './dto/delete-client.dto';
import { QueryClientAppointmentsDto } from './dto/query-client-appointments.dto';
import { QueryClientDto } from './dto/query-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientAppointmentListEntity } from './entities/client-appointment.entity';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('client')
@Controller('client')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new client (clinic or individual)' })
  @ApiCreatedResponse({ type: ClientEntity })
  @ApiBadRequestResponse({
    description:
      'Invalid payload, including a taxId that does not match its taxIdType ' +
      'or is sent without it',
  })
  @ApiConflictResponse({
    description:
      'The owner already has a client with this name (DUPLICATED_CLIENT_NAME) ' +
      'or this tax id (DUPLICATED_CLIENT_TAX_ID)',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateClientDto) {
    return this.clientService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: "Lists the user's clients, optionally filtered by type",
  })
  @ApiOkResponse({ type: ClientEntity, isArray: true })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryClientDto,
  ) {
    return this.clientService.findAll(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Finds a client by id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClientEntity })
  @ApiNotFoundResponse({ description: 'Client not found' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.clientService.findOne(id, user.id);
  }

  @Get(':id/appointments')
  @ApiOperation({
    summary: "List a client's completed appointments in a period",
    description:
      'Latest first. total covers the whole period, not only the page. from ' +
      'and to are São Paulo calendar days, both inclusive.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClientAppointmentListEntity })
  @ApiBadRequestResponse({
    description:
      'A date that is not YYYY-MM-DD or does not exist, a page out of range ' +
      '(VALIDATION_ERROR), or from after to (INVALID_REQUEST)',
  })
  @ApiNotFoundResponse({
    description: 'Client not found, deleted or owned by someone else',
  })
  findAppointments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryClientAppointmentsDto,
  ) {
    return this.clientService.findAppointments(id, user.id, query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a client' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClientEntity })
  @ApiBadRequestResponse({
    description:
      'Invalid payload, including a taxId that does not match its taxIdType ' +
      'or is sent without it',
  })
  @ApiNotFoundResponse({ description: 'Client not found' })
  @ApiConflictResponse({
    description:
      'The owner already has a client with this name (DUPLICATED_CLIENT_NAME) ' +
      'or this tax id (DUPLICATED_CLIENT_TAX_ID)',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientService.update(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a client (soft delete)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DeleteClientDto })
  @ApiNotFoundResponse({ description: 'Client not found' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.clientService.remove(id, user.id);
  }
}
