import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { SavePricingSettingsDto } from './dto/save-pricing-settings.dto';
import { SaveTransportCostDto } from './dto/save-transport-cost.dto';
import { PricingSettingsEntity } from './entities/pricing-settings.entity';
import { TransportCostEntity } from './entities/transport-cost.entity';
import { PricingSettingsService } from './pricing-settings.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

/**
 * A singleton per user: no id in the path, the token says whose settings
 * these are (ADR-11).
 */
@ApiTags('pricing-settings')
@Controller('pricing-settings')
export class PricingSettingsController {
  constructor(
    private readonly pricingSettingsService: PricingSettingsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "The signed-in user's income goal, weekly hours and safety margin",
    description:
      'Answers 404 PRICING_SETTINGS_NOT_FOUND until the three goals are ' +
      'saved, including when only the transport cost (US18) was saved. The ' +
      "app shows that as the calculator's initial state, not as an error. " +
      'The transport cost is read at GET /pricing-settings/transport.',
  })
  @ApiOkResponse({ type: PricingSettingsEntity })
  @ApiNotFoundResponse({
    description:
      'The goals were never saved: not configured yet (PRICING_SETTINGS_NOT_FOUND)',
  })
  find(@CurrentUser() user: AuthenticatedUser) {
    return this.pricingSettingsService.find(user.id);
  }

  @Put()
  @ApiOperation({
    summary: 'Save the income goal, weekly hours and safety margin',
    description:
      'Creates the settings on the first call and overwrites them after that. ' +
      'The three fields are required together. The transport cost (US18) is ' +
      'kept as it was and is saved at PATCH /pricing-settings/transport. ' +
      'Idempotent: resending the same body answers the same.',
  })
  @ApiOkResponse({ type: PricingSettingsEntity })
  @ApiBadRequestResponse({
    description:
      'Invalid payload (VALIDATION_ERROR): a missing or non-numeric field, more ' +
      'than 2 decimal places, an income goal or weekly hours of zero or less, ' +
      'weekly hours over 168, a safety margin outside 0–100, or an unexpected field',
  })
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SavePricingSettingsDto,
  ) {
    return this.pricingSettingsService.save(user.id, dto);
  }

  @Get('transport')
  @ApiOperation({
    summary: "The signed-in user's monthly transport cost",
    description:
      'Answers 404 TRANSPORT_COST_NOT_FOUND until the cost is saved, even ' +
      'when the three goals (US19) already are. The app shows that as an ' +
      'empty field, not as an error. Zero is a saved cost, not an empty one.',
  })
  @ApiOkResponse({ type: TransportCostEntity })
  @ApiNotFoundResponse({
    description:
      'The transport cost was never saved (TRANSPORT_COST_NOT_FOUND)',
  })
  findTransport(@CurrentUser() user: AuthenticatedUser) {
    return this.pricingSettingsService.findTransportCost(user.id);
  }

  @Patch('transport')
  @ApiOperation({
    summary: 'Save the monthly transport cost',
    description:
      'Creates the settings row on the first call and overwrites the cost ' +
      'after that, answering 200 either way. The three goals (US19) are kept ' +
      'as they were. Idempotent: resending the same body answers the same.',
  })
  @ApiOkResponse({ type: TransportCostEntity })
  @ApiBadRequestResponse({
    description:
      'Invalid payload (VALIDATION_ERROR): a missing or non-numeric cost, ' +
      'a negative one, more than 2 decimal places, a value above the column ' +
      'limit, or an unexpected field. Zero is valid',
  })
  saveTransport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveTransportCostDto,
  ) {
    return this.pricingSettingsService.saveTransportCost(user.id, dto);
  }
}
