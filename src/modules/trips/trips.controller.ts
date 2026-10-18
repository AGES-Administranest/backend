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
import type { Response } from 'express';

import { CreateTripDto } from './dto/create-trip.dto';
import { QueryTripDto } from './dto/query-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripsService } from './trips.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Post()
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
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryTripDto,
  ) {
    return this.tripsService.findAll(user.id, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tripsService.findOne(id, user.id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTripDto,
  ) {
    return this.tripsService.update(id, user.id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tripsService.remove(id, user.id);
  }
}
