import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ProcedureEstimateDto } from './dto/procedure-estimate.dto';
import { ProcedureEstimateResponse } from './entities/procedure-estimate.entity';
import { ProcedureEstimateService } from './procedure-estimate.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

const CLIENT_ID = '0b6f3c2e-8a51-4d7e-9c3a-5f2e1d4b7a90';
const SYRINGE_ID = '6f1c1e44-5a1d-4f0e-9b7b-2f5d6f3a9c11';
const CATHETER_ID = 'c3d9a7b2-1e4f-4a6b-8d2c-7e5f9a1b3c48';

// One worked example, in and out: 6,000 of owner draw and a 10% margin over
// 40 weekly hours give 38.08 an hour (34.62 without the margin), two days at
// the client cost 65.80 and 32.90 in trips, and the syringe costs 12.50.
const REQUEST_EXAMPLE = {
  durationMinutes: 90,
  clientId: CLIENT_ID,
  supplies: [
    { itemId: SYRINGE_ID, quantity: 2 },
    { itemId: CATHETER_ID, quantity: 1 },
  ],
};

const RESPONSE_EXAMPLE: ProcedureEstimateResponse = {
  minimumPrice: '131.47',
  breakEvenPrice: '126.28',
  hoursCost: '57.12',
  tripCost: '49.35',
  suppliesCost: '25.00',
  hourlyRateUsed: '38.08',
  minimumHourlyRateUsed: '34.62',
  tripEstimateAvailable: true,
  tripEstimateDays: 2,
  suppliesWithoutCost: [CATHETER_ID],
  durationMinutes: 90,
  month: 11,
  year: 2026,
};

const DESCRIPTION = [
  'minimumPrice = hoursCost + tripCost + suppliesCost. Each part is rounded ' +
    'half-up to cents and the price is the sum of the rounded parts.',
  '- hoursCost = hourlyRateUsed × durationMinutes ÷ 60. The hourly rate is ' +
    'the one GET /pricing/hourly-rate (US20) returns, with the safety margin, ' +
    'for the current month in Brasília (America/Sao_Paulo). GET ' +
    '/pricing/hourly-rate without month and year uses the UTC month, so from ' +
    '21:00 to midnight on the last day of a month the estimate uses that ' +
    "month's rate while the hourly-rate screen already shows the next one's.",
  '- tripCost = the average of what each of the latest 10 days with trips to ' +
    'the client added up to (US14). Summing by day counts the way there and ' +
    'back as one visit. Only trips marked with the client count: a way back ' +
    'recorded without it is left out, and the estimate comes out lower.',
  "- suppliesCost = Σ quantity × the item's defaultUnitCost, the price of its " +
    'latest purchase. An item without a cost counts as 0 and is listed in ' +
    'suppliesWithoutCost.',
  'breakEvenPrice is the same sum with the hourly rate without the margin ' +
    '(minimumHourlyRateUsed).',
  'tripEstimateAvailable is false, and tripCost 0, when the request has no ' +
    'clientId or the client has no trips yet.',
  "Known effects: the hourly rate already spreads the month's trips and " +
    "supply purchases over every hour, so adding this procedure's own trip " +
    'and supplies counts part of them twice and the estimate errs on the high ' +
    'side. Early in a month, with few expenses recorded yet, the hourly rate ' +
    'and the estimate come out lower than they should.',
  'Nothing is stored: every request reads the current goals, costs, trips ' +
    'and items.',
].join('\n\n');

@ApiTags('pricing')
// A controller of its own under /pricing, beside the hourly-rate one, so each
// route's documentation and dependencies stay apart.
@Controller('pricing')
export class ProcedureEstimateController {
  constructor(
    private readonly procedureEstimateService: ProcedureEstimateService,
  ) {}

  /** A simulation: nothing is stored, so it answers 200, not 201. */
  @Post('procedure-estimate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The minimum price to charge for a procedure (US21)',
    description: DESCRIPTION,
  })
  @ApiBody({
    type: ProcedureEstimateDto,
    examples: {
      procedure: {
        summary: '90 minutes at a client, with two supplies',
        value: REQUEST_EXAMPLE,
      },
      hoursOnly: {
        summary: 'Only the duration: the hours alone',
        value: { durationMinutes: 60 },
      },
    },
  })
  @ApiOkResponse({
    type: ProcedureEstimateResponse,
    description: 'The estimate for the first example request',
    example: RESPONSE_EXAMPLE,
  })
  @ApiBadRequestResponse({
    description:
      'durationMinutes missing, not a whole number or outside 1–1440; ' +
      'clientId or an itemId not a UUID; more than 100 supplies; a quantity ' +
      'not positive, with more than 3 decimal places or over 10000; or an ' +
      'unexpected field (VALIDATION_ERROR)',
  })
  @ApiNotFoundResponse({
    description:
      'The income goal, weekly hours and margin were never saved ' +
      '(PRICING_SETTINGS_NOT_FOUND), as for GET /pricing/hourly-rate, so the ' +
      'app sends the user to the same setup screen. Checked before anything ' +
      'else in the request.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The client, or an item, is missing, deleted or of another account ' +
      '(CLIENT_NOT_FOUND, ITEM_NOT_FOUND, with the id in details)',
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)',
  })
  estimate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ProcedureEstimateDto,
  ): Promise<ProcedureEstimateResponse> {
    return this.procedureEstimateService.estimate(user.id, dto);
  }
}
