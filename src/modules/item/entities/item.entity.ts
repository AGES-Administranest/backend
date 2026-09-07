import { Item, MeasurementUnit, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export class ItemEntity implements Item {
  /** Identificador único do item */
  id!: string;

  /** Identificador do fornecedor, se houver */
  supplierId!: string | null;

  /** Unidade de medida do item */
  unit!: MeasurementUnit;

  /** Nome do item */
  name!: string;

  /** Custo unitário padrão */
  defaultUnitCost!: Prisma.Decimal | null;

  /** Estoque mínimo */
  minimumStock!: Prisma.Decimal | null;

  /** Quantidade atual em estoque */
  currentQuantity!: Prisma.Decimal;

  /** Indica se o item está ativo */
  active!: boolean;

  /** Data de criação */
  createdAt!: Date;

  /** Data da última atualização */
  updatedAt!: Date;

  /** Data de inativação (soft delete) */
  deletedAt!: Date | null;
}