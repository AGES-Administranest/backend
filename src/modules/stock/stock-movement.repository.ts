import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class StockMovementRepository {
  constructor(private readonly prisma: PrismaService) {}
}