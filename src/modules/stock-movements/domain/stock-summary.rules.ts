import {
  AdjustmentReason,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import {
  type Decimal,
  type DecimalInput,
  type MovementLike,
  assertPositiveQuantity,
} from './stock-movement.rules';

/**
 * Pure arithmetic for the stock history summary (US12).
 *
 * Same spirit as `stock-movement.rules.ts`: no Nest, no Prisma Client, no HTTP.
 * The repository fetches the movements of a period; these functions turn them
 * into the consolidated numbers the summary endpoint returns. Everything is
 * `Prisma.Decimal`, so money never goes through a float.
 */

/** What a movement has to carry to take part in the summary. */
export interface SummarizableMovement extends MovementLike {
  source: StockMovementSource;
  adjustmentReason?: AdjustmentReason | null;
  /** cost snapshot at the time of the movement */
  unitCost: DecimalInput;
  /** `appointment.procedureName`; only meaningful when `source = APPOINTMENT` */
  procedureName?: string | null;
}

export interface QuantityAndValue {
  quantity: Decimal;
  /** sum of quantity × unitCost, rounded to 2 places (money) once, at the end */
  value: Decimal;
}

export interface ProcedureConsumption extends QuantityAndValue {
  /** `null` when the appointment has no procedure name */
  procedureName: string | null;
}

export interface AdjustmentByReason extends QuantityAndValue {
  reason: AdjustmentReason;
  /** OUTBOUND is a loss; INBOUND is a count that found more than the system had */
  type: StockMovementType;
}

export interface PeriodSummary {
  /** every INBOUND movement of the period, whatever the source */
  inbound: QuantityAndValue;
  /** every OUTBOUND movement of the period, whatever the source */
  outbound: QuantityAndValue;
  /** OUTBOUND + APPOINTMENT, grouped by procedure, largest value first */
  consumptionByProcedure: ProcedureConsumption[];
  /** MANUAL_ADJUSTMENT grouped by reason and direction, largest value first */
  adjustmentsByReason: AdjustmentByReason[];
}

export interface PeriodBalance {
  openingBalance: Decimal;
  inbound: Decimal;
  outbound: Decimal;
  closingBalance: Decimal;
}

const MONEY_DECIMAL_PLACES = 2;
const ZERO = new Prisma.Decimal(0);

const toDecimal = (value: DecimalInput): Decimal =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

/** Soft-deleted movements never count, in any total (same rule as `stockBalance`). */
const active = <T extends MovementLike>(movements: readonly T[]): T[] =>
  movements.filter(movement => movement.deletedAt == null);

/** `quantity × unitCost` of one movement, exact (not rounded). */
export function movementValue(
  movement: Pick<SummarizableMovement, 'quantity' | 'unitCost'>,
): Decimal {
  return assertPositiveQuantity(movement.quantity).times(
    toDecimal(movement.unitCost),
  );
}

/**
 * Balance out of the two sums the database returns for a `GROUP BY type`:
 * inbound minus outbound. Either sum is `null` when there were no rows of
 * that direction.
 */
export function balanceFromSums(
  inbound: DecimalInput | null,
  outbound: DecimalInput | null,
): Decimal {
  return toDecimal(inbound ?? 0).minus(toDecimal(outbound ?? 0));
}

/** Consolidated numbers of a period (the "summary" block of US12). */
export function summarizePeriod(
  movements: readonly SummarizableMovement[],
): PeriodSummary {
  const counted = active(movements);
  const inbound = counted.filter(m => m.type === StockMovementType.INBOUND);
  const outbound = counted.filter(m => m.type === StockMovementType.OUTBOUND);

  return {
    inbound: totals(inbound),
    outbound: totals(outbound),
    consumptionByProcedure: consumptionByProcedure(outbound),
    adjustmentsByReason: adjustmentsByReason(counted),
  };
}

/**
 * Opening balance + the period's movements = closing balance. The opening
 * balance comes from the ledger before the period (never from
 * `item.currentQuantity`), so closing always agrees with the sum of the
 * movements — the acceptance criterion of US12.
 */
export function periodBalance(
  openingBalance: DecimalInput,
  movements: readonly MovementLike[],
): PeriodBalance {
  const opening = toDecimal(openingBalance);
  let inbound = ZERO;
  let outbound = ZERO;

  for (const movement of active(movements)) {
    const quantity = assertPositiveQuantity(movement.quantity);
    if (movement.type === StockMovementType.INBOUND) {
      inbound = inbound.plus(quantity);
    } else {
      outbound = outbound.plus(quantity);
    }
  }

  return {
    openingBalance: opening,
    inbound,
    outbound,
    closingBalance: opening.plus(inbound).minus(outbound),
  };
}

function totals(movements: readonly SummarizableMovement[]): QuantityAndValue {
  let quantity = ZERO;
  let value = ZERO;

  for (const movement of movements) {
    quantity = quantity.plus(assertPositiveQuantity(movement.quantity));
    value = value.plus(movementValue(movement));
  }

  return { quantity, value: value.toDecimalPlaces(MONEY_DECIMAL_PLACES) };
}

function consumptionByProcedure(
  outbound: readonly SummarizableMovement[],
): ProcedureConsumption[] {
  const groups = new Map<string | null, SummarizableMovement[]>();

  for (const movement of outbound) {
    if (movement.source !== StockMovementSource.APPOINTMENT) continue;
    // A blank name is the same as no name: one "unnamed" bucket, not two.
    const procedureName = movement.procedureName?.trim() || null;
    groups.set(procedureName, [...(groups.get(procedureName) ?? []), movement]);
  }

  return [...groups]
    .map(([procedureName, group]) => ({ procedureName, ...totals(group) }))
    .sort(byValueDescThenLabel(entry => entry.procedureName ?? ''));
}

function adjustmentsByReason(
  movements: readonly SummarizableMovement[],
): AdjustmentByReason[] {
  const groups = new Map<
    string,
    {
      reason: AdjustmentReason;
      type: StockMovementType;
      group: SummarizableMovement[];
    }
  >();

  for (const movement of movements) {
    if (movement.source !== StockMovementSource.MANUAL_ADJUSTMENT) continue;
    // The invariant says the reason is always there; a report must not crash
    // on a bad historic row, so it falls back to OTHER instead of throwing.
    const reason = movement.adjustmentReason ?? AdjustmentReason.OTHER;
    const key = `${movement.type}:${reason}`;
    const entry = groups.get(key) ?? { reason, type: movement.type, group: [] };
    entry.group.push(movement);
    groups.set(key, entry);
  }

  return [...groups.values()]
    .map(({ reason, type, group }) => ({ reason, type, ...totals(group) }))
    .sort(byValueDescThenLabel(entry => `${entry.reason}:${entry.type}`));
}

/** Largest value first; ties broken by label so the order is stable. */
const byValueDescThenLabel =
  <T extends QuantityAndValue>(labelOf: (entry: T) => string) =>
  (a: T, b: T): number => {
    const byValue = b.value.comparedTo(a.value);
    return byValue !== 0 ? byValue : labelOf(a).localeCompare(labelOf(b));
  };
