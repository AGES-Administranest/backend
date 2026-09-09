import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { StockMovementRepository } from './stock-movement.repository';
import { StockMovementService } from './stock-movement.service';

@Module({
  imports: [PrismaModule],
  providers: [StockMovementRepository, StockMovementService],
  exports: [StockMovementService],
})
export class StockModule {}