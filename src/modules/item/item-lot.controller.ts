import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { CreateItemLotDto } from './dto/create-item-lot.dto';
import { ItemLotEntity } from './entities/item-lot.entity';
import { ItemLotService } from './item-lot.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('item')
@Controller('item/:itemId/lot')
export class ItemLotController {
  constructor(private readonly itemLotService: ItemLotService) {}

  @Post()
  @ApiOperation({
    summary:
      'Registers stock for an item: sums into the matching lot when the expiration date is the same, otherwise opens a new lot',
  })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiCreatedResponse({ type: ItemLotEntity })
  @ApiBadRequestResponse({
    description:
      'Invalid payload, or unitCost missing when the item has no defaultUnitCost',
  })
  @ApiNotFoundResponse({ description: 'Item not found' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: CreateItemLotDto,
  ) {
    return this.itemLotService.create(itemId, user.id, dto);
  }
}
