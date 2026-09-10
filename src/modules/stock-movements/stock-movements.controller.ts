import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { CreateStockPurchaseDto } from './dto/create-stock-purchase.dto';
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

  @Post('purchases')
  @ApiOperation({
    summary: 'Registra uma entrada manual de compra de estoque',
    description:
      'Para compras sem pedido ou nota para importar (balcão, avulsa). Delega ao ' +
      'serviço central (INBOUND / MANUAL_PURCHASE), atualiza o custo unitário do ' +
      'item para o preço da compra e reativa o item se estiver inativo.',
  })
  @ApiCreatedResponse({ type: StockMovementEntity })
  @ApiNotFoundResponse({ description: 'Item não encontrado' })
  @ApiBadRequestResponse({
    description: 'Payload inválido ou data no futuro',
  })
  @ApiUnprocessableEntityResponse({ description: 'Fornecedor não encontrado' })
  @ApiUnauthorizedResponse({ description: 'Token ausente ou inválido' })
  registerPurchase(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStockPurchaseDto,
  ) {
    return this.stockMovementsService.registerPurchase(user, dto);
  }
}
