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

import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { QueryVehicleDto } from './dto/query-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleEntity } from './entities/vehicle.entity';
import { VehiclesService } from './vehicles.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('vehicles')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Post()
  @ApiOperation({ summary: 'Register a vehicle' })
  @ApiCreatedResponse({ type: VehicleEntity })
  @ApiBadRequestResponse({
    description:
      'Invalid payload: a missing or blank field, a non-positive or too precise ' +
      'number, a value over the limit, an unknown fuel type or an unexpected field',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateVehicleDto,
  ) {
    return this.vehiclesService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      "List the user's vehicles: active ones by default, or ?active=false",
  })
  @ApiOkResponse({ type: VehicleEntity, isArray: true })
  @ApiBadRequestResponse({ description: 'active is neither true nor false' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryVehicleDto,
  ) {
    return this.vehiclesService.findAll(user.id, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Find a vehicle by id, including an inactive one',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: VehicleEntity })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiNotFoundResponse({
    description:
      'Missing, deleted or another account vehicle (VEHICLE_NOT_FOUND)',
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vehiclesService.findOne(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update a vehicle: any field, including the fuel price; active: true reactivates it',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: VehicleEntity })
  @ApiBadRequestResponse({
    description:
      'The id is not a UUID, or the payload is invalid: a blank or null field, ' +
      'a non-positive or too precise number, a value over the limit, an unknown ' +
      'fuel type or an unexpected field',
  })
  @ApiNotFoundResponse({
    description:
      'Missing, deleted or another account vehicle (VEHICLE_NOT_FOUND)',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehiclesService.update(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Inactivate a vehicle (does not delete it)',
    description:
      'Sets active to false and keeps the record: it stays readable by id, ' +
      'so the trips that used it keep their vehicle. Idempotent: inactivating ' +
      'an inactive vehicle answers 200 with the same record. PATCH with ' +
      'active: true reactivates it.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: VehicleEntity })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiNotFoundResponse({
    description:
      'Missing, deleted or another account vehicle (VEHICLE_NOT_FOUND)',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vehiclesService.remove(id, user.id);
  }
}
