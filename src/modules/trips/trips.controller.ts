import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { CreateTripDto } from './dto/create-trip.dto';
import { QueryTripDto } from './dto/query-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripEntity, TripListEntity } from './entities/trip.entity';
import { TripsService } from './trips.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

const MODES =
  'OWN_VEHICLE needs vehicleId and distanceKm, and the server calculates the ' +
  'cost from the vehicle (sending cost is a 400). RIDE (app or taxi) needs ' +
  'cost, the fare paid, takes no vehicleId, and distanceKm is optional.';

const INVALID_PAYLOAD =
  'Invalid payload: a missing, blank or malformed field, a value over the ' +
  'limit or an unexpected field (VALIDATION_ERROR); or fields that do not ' +
  'match the mode (TRIP_MODE_FIELDS_INVALID, with details.missing and ' +
  'details.notAllowed)';

const INVALID_REFERENCE =
  'A vehicle, appointment or client that is missing, deleted or of another ' +
  'account (VEHICLE_NOT_FOUND, APPOINTMENT_NOT_FOUND, CLIENT_NOT_FOUND); an ' +
  'inactive vehicle chosen for the trip (TRIP_VEHICLE_INACTIVE); or a clientId ' +
  "that is not the appointment's client (TRIP_CLIENT_MISMATCH)";

const NOT_FOUND = 'Missing, deleted or another account trip (TRIP_NOT_FOUND)';

const EXPENSE =
  'The trip cost is posted as a professional expense under Travel in the ' +
  'financial statement and follows every change; a trip that costs 0 posts ' +
  'none.';

const NO_TRAVEL_CATEGORY =
  'or the Travel category is missing, so the expense cannot be posted and ' +
  'the trip is not saved (FINANCIAL_CATEGORY_NOT_SEEDED)';

const VEHICLE_ID = '6f1c1e44-5a1d-4f0e-9b7b-2f5d6f3a9c11';

// One example per mode: no single body is valid for both.
const CREATE_EXAMPLES = {
  ownVehicle: {
    summary: 'By own vehicle: the server prices it',
    value: {
      mode: 'OWN_VEHICLE',
      vehicleId: VEHICLE_ID,
      occurredOn: '2026-10-18',
      origin: 'Casa',
      destination: 'Clínica Veterinária São Francisco',
      distanceKm: 30,
    },
  },
  ride: {
    summary: 'By app or taxi: the fare paid',
    value: {
      mode: 'RIDE',
      occurredOn: '2026-10-18',
      origin: 'Clínica Veterinária São Francisco',
      destination: 'Casa',
      cost: 32.9,
    },
  },
};

const UPDATE_EXAMPLES = {
  distance: {
    summary: 'Fix the distance: repriced with the copied cost per km',
    value: { distanceKm: 32.5 },
  },
  toRide: {
    summary: 'Switch to RIDE: the vehicle is dropped',
    value: { mode: 'RIDE', cost: 40 },
  },
  toOwnVehicle: {
    summary: 'Switch to OWN_VEHICLE: priced from the vehicle',
    value: { mode: 'OWN_VEHICLE', vehicleId: VEHICLE_ID, distanceKm: 30 },
  },
};

@ApiTags('trips')
@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Post()
  @ApiOperation({
    summary: 'Record a trip',
    description:
      `${MODES} ${EXPENSE} Several trips may share a date. With an id ` +
      'generated on the device, resending the same trip answers 200 with the ' +
      'stored one.',
  })
  @ApiBody({ type: CreateTripDto, examples: CREATE_EXAMPLES })
  @ApiCreatedResponse({ type: TripEntity })
  @ApiOkResponse({
    type: TripEntity,
    description: 'The same trip was already recorded with this id',
  })
  @ApiBadRequestResponse({
    description: `${INVALID_PAYLOAD}; ${NO_TRAVEL_CATEGORY}`,
  })
  @ApiConflictResponse({
    description:
      'The id is taken by a trip with different content, a deleted trip or ' +
      'another account (TRIP_ID_CONFLICT)',
  })
  @ApiUnprocessableEntityResponse({ description: INVALID_REFERENCE })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTripDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.tripsService.createWithResult(user.id, dto);
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.trip;
  }

  @Get()
  @ApiOperation({
    summary: "List the user's trips in a period, with its totals",
    description:
      'Latest day first; within a day, in the order the trips were recorded. ' +
      'total, totalKm and totalCost cover the whole period, not only the page.',
  })
  @ApiOkResponse({ type: TripListEntity })
  @ApiBadRequestResponse({
    description:
      'A date that is not YYYY-MM-DD or does not exist, a page out of range ' +
      '(VALIDATION_ERROR), or from after to (INVALID_REQUEST)',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryTripDto,
  ) {
    return this.tripsService.findAll(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Find a trip by id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TripEntity })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tripsService.findOne(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a trip, including its mode, and recalculate its cost',
    description:
      'A field left out keeps its value; null clears appointmentId, clientId ' +
      "or a RIDE's distance. The mode rules apply to the trip as it ends up. " +
      `${MODES} A new distance is ` +
      'priced with the cost per km copied when the trip was recorded, so a ' +
      'later fuel price change does not reach it; choosing another vehicle ' +
      "copies that vehicle's current cost per km. A trip whose vehicle was " +
      `inactivated since can still be edited. ${EXPENSE}`,
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateTripDto, examples: UPDATE_EXAMPLES })
  @ApiOkResponse({ type: TripEntity })
  @ApiBadRequestResponse({
    description: `The id is not a UUID, or a null required field. ${INVALID_PAYLOAD}; ${NO_TRAVEL_CATEGORY}`,
  })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiUnprocessableEntityResponse({ description: INVALID_REFERENCE })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTripDto,
  ) {
    return this.tripsService.update(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a trip and its expense (soft delete)',
    description:
      'Sets deleted_at and keeps the row: the trip leaves the listing and its ' +
      'totals, and GET /trips/:id answers 404 from then on. Its expense ' +
      'leaves the financial statement too: the entry is soft-deleted, and no ' +
      'reversing entry is posted. Deleting it again answers 404.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    type: TripEntity,
    description: 'The trip as it was deleted',
  })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tripsService.remove(id, user.id);
  }
}
