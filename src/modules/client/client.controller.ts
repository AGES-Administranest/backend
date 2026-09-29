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
import { QueryClientDto } from './dto/query-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
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
