import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { StockMovementEntity } from './entities/stock-movement.entity';
import { StockMovementsService } from './stock-movements.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('stock-movements')
@Controller('stock-movements')
export class StockMovementsController {
  constructor(private readonly stockMovementsService: StockMovementsService) {}

  @Post('adjustments')
  @ApiOperation({
    summary: 'Registra um ajuste manual de saída de estoque (perda)',
    description:
      'Delega ao serviço central de movimentação (OUTBOUND / MANUAL_ADJUSTMENT), ' +
      'dispara a verificação de estoque mínimo e limpa a flag needsAdjustment do item.',
  })
  @ApiCreatedResponse({ type: StockMovementEntity })
  @ApiNotFoundResponse({ description: 'Item não encontrado' })
  @ApiBadRequestResponse({
    description: 'Payload inválido ou ajuste deixaria o saldo negativo',
  })
  @ApiUnauthorizedResponse({ description: 'Token ausente ou inválido' })
  registerAdjustment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStockAdjustmentDto,
  ) {
    return this.stockMovementsService.registerAdjustment(user, dto);
  }
}
