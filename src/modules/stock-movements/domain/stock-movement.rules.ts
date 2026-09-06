import {
  AdjustmentReason,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import { DomainError } from '../../../shared/errors/domain-error';

/**
 * Regras puras do livro-razão de estoque (`stock_movement`).
 *
 * Sem Nest, sem Prisma Client, sem HTTP: só a aritmética e as invariantes que o
 * dicionário de dados descreve (ver `docs/data-dictionary.md`). O service de
 * estoque, quando existir, chama estas funções; os testes cobrem elas
 * diretamente.
 *
 * Toda a aritmética usa `Prisma.Decimal` (decimal.js), nunca `number`: as
 * quantidades são `NUMERIC(14,3)` no banco e somá-las como float binário
 * produziria resíduos (ex.: `0.1 + 0.2 - 0.3 !== 0`) que ligariam o
 * `needs_adjustment` da US10 por engano.
 *
 * Convenção de sinal (a regra que todo cálculo de saldo depende):
 * - `quantity` é SEMPRE positiva (nunca 0, nunca negativa);
 * - a direção vem EXCLUSIVAMENTE de `type`: INBOUND soma, OUTBOUND subtrai;
 * - vale para toda origem, inclusive ajuste e estorno.
 */

export type Decimal = Prisma.Decimal;

/** Aceito onde uma quantidade/saldo entra: o `Decimal` do banco, ou algo conversível. */
export type DecimalInput = Prisma.Decimal | number | string;

const toDecimal = (value: DecimalInput): Decimal =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

/** O mínimo que uma movimentação precisa ter para entrar no cálculo de saldo. */
export interface MovementLike {
  type: StockMovementType;
  /** magnitude positiva — o sinal vem do `type`, nunca daqui */
  quantity: DecimalInput;
  /** movimentações com soft delete não contam no saldo */
  deletedAt?: Date | null;
}

/** Forma completa validada por {@link assertValidMovement}. */
export interface MovementShape extends MovementLike {
  source: StockMovementSource;
  adjustmentReason?: AdjustmentReason | null;
}

/**
 * `quantity` com o sinal do `type`. É a única forma correta de transformar uma
 * linha de `stock_movement` num número somável.
 *
 * @throws DomainError se `quantity` não for estritamente positiva.
 */
export function signedQuantity(movement: MovementLike): Decimal {
  const quantity = assertPositiveQuantity(movement.quantity);
  return movement.type === StockMovementType.INBOUND
    ? quantity
    : quantity.negated();
}

/**
 * Saldo resultante de uma lista de movimentações. Ignora as que têm
 * `deletedAt` preenchido (soft delete).
 */
export function stockBalance(movements: readonly MovementLike[]): Decimal {
  return movements
    .filter(m => m.deletedAt == null)
    .reduce((total, m) => total.plus(signedQuantity(m)), new Prisma.Decimal(0));
}

/**
 * O `type` de um estorno (`source = CORRECTION_REVERSAL`): sempre o oposto do
 * registro que está sendo corrigido, com a mesma `quantity`.
 */
export function reversalType(original: StockMovementType): StockMovementType {
  return original === StockMovementType.INBOUND
    ? StockMovementType.OUTBOUND
    : StockMovementType.INBOUND;
}

/**
 * Traduz uma correção de saldo (delta assinado) para a forma canônica:
 * `quantity` positiva + `type`. Um delta exatamente zero não gera movimentação.
 */
export function movementForDelta(
  delta: DecimalInput,
): { type: StockMovementType; quantity: Decimal } | null {
  const d = toDecimal(delta);
  if (d.isZero()) return null;
  return d.isPositive()
    ? { type: StockMovementType.INBOUND, quantity: d }
    : { type: StockMovementType.OUTBOUND, quantity: d.negated() };
}

/**
 * US10: um saldo negativo é o gatilho para marcar o item como "precisa de
 * ajuste". O flag em si (`item.needs_adjustment`) é persistido — ele continua
 * ligado mesmo que uma entrada posterior zere o negativo, até o usuário
 * registrar o ajuste. Esta função é só a condição de disparo.
 */
export function balanceRequiresAdjustment(balance: DecimalInput): boolean {
  return toDecimal(balance).isNegative();
}

/**
 * Invariante que o Prisma não expressa: `adjustmentReason` existe se e somente
 * se `source = MANUAL_ADJUSTMENT`.
 *
 * @throws DomainError com kind `INVALID_INPUT`.
 */
export function assertValidMovement(movement: MovementShape): void {
  assertPositiveQuantity(movement.quantity);

  const isAdjustment =
    movement.source === StockMovementSource.MANUAL_ADJUSTMENT;
  const hasReason = movement.adjustmentReason != null;

  if (isAdjustment && !hasReason) {
    throw new DomainError(
      'INVALID_INPUT',
      'ESTOQUE_MOTIVO_AJUSTE_INVALIDO',
      'Ajuste manual de estoque exige um motivo (adjustmentReason)',
      { source: movement.source },
    );
  }
  if (!isAdjustment && hasReason) {
    throw new DomainError(
      'INVALID_INPUT',
      'ESTOQUE_MOTIVO_AJUSTE_INVALIDO',
      'adjustmentReason só é válido quando source = MANUAL_ADJUSTMENT',
      { source: movement.source },
    );
  }
}

/**
 * Normaliza e valida uma quantidade de movimentação.
 *
 * @returns a quantidade como `Decimal`.
 * @throws DomainError se não for um número finito > 0.
 */
export function assertPositiveQuantity(quantity: DecimalInput): Decimal {
  let d: Decimal;
  try {
    d = toDecimal(quantity);
  } catch {
    d = new Prisma.Decimal(NaN);
  }
  if (!d.isFinite() || d.isNaN() || d.lessThanOrEqualTo(0)) {
    throw new DomainError(
      'INVALID_INPUT',
      'ESTOQUE_QUANTIDADE_INVALIDA',
      'quantity de uma movimentação de estoque deve ser positiva',
      { quantity: String(quantity) },
    );
  }
  return d;
}
