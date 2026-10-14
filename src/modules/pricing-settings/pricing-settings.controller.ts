import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { SavePricingSettingsDto } from './dto/save-pricing-settings.dto';
import { PricingSettingsEntity } from './entities/pricing-settings.entity';
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
      "app shows that as the calculator's initial state, not as an error.",
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
      'kept as it was. Idempotent: resending the same body answers the same.',
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
}
