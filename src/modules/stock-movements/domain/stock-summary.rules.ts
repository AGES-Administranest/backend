import {
  AdjustmentReason,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

/**
 * Pure aggregation for the period summary (US12).
 *
 * Sums stay in `Decimal` end to end: adding a few hundred line values in
 * floating point drifts by cents, and cents are what makes a money report
 * stop being trusted.
 */

/** The little a movement needs to be summarised. */
export interface SummarisableMovement {
  type: StockMovementType;
  source: StockMovementSource;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  adjustmentReason: AdjustmentReason | null;
  appointment: { procedureName: string | null } | null;
}

export interface SummaryTotals {
  /** How many movements fell in this bucket. */
  count: number;
  /** Sum of their quantities. */
  quantity: string;
  /** Sum of quantity x unitCost, in reais. */
  value: string;
}

export interface GroupedTotals extends SummaryTotals {
  /** The label to display — the spelling most people used. */
  label: string;
}

export interface AdjustmentTotals extends SummaryTotals {
  reason: AdjustmentReason;
}

const ZERO = new Prisma.Decimal(0);

/**
 * Same procedure when the names differ only by case, accents or spacing.
 *
 * `procedure_name` is free text typed on a phone, so grouping the raw string
 * would report "Castração", "castracao" and "Castração " as three procedures.
 * Folding accents is deliberate: on a mobile keyboard, dropping them is the rule.
 */
export function procedureKey(procedureName: string | null): string {
  return (procedureName ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Used when the appointment records no procedure at all. */
export const UNNAMED_PROCEDURE = 'Sem procedimento';

function totalsOf(movements: readonly SummarisableMovement[]): SummaryTotals {
  const quantity = movements.reduce((sum, m) => sum.plus(m.quantity), ZERO);
  const value = movements.reduce(
    (sum, m) => sum.plus(m.quantity.times(m.unitCost)),
    ZERO,
  );
  return {
    count: movements.length,
    quantity: quantity.toString(),
    value: value.toString(),
  };
}

/** Everything that came in, and everything that went out, over the period. */
export function directionTotals(movements: readonly SummarisableMovement[]): {
  inbound: SummaryTotals;
  outbound: SummaryTotals;
} {
  return {
    inbound: totalsOf(
      movements.filter(m => m.type === StockMovementType.INBOUND),
    ),
    outbound: totalsOf(
      movements.filter(m => m.type === StockMovementType.OUTBOUND),
    ),
  };
}

/** Consumption by procedure, heaviest first. Appointment movements only. */
export function consumptionByProcedure(
  movements: readonly SummarisableMovement[],
): GroupedTotals[] {
  const groups = new Map<string, SummarisableMovement[]>();
  const spellings = new Map<string, Map<string, number>>();

  for (const movement of movements) {
    if (movement.source !== StockMovementSource.APPOINTMENT) continue;

    const key = procedureKey(movement.appointment?.procedureName ?? null);
    groups.set(key, [...(groups.get(key) ?? []), movement]);

    const raw = movement.appointment?.procedureName?.trim();
    if (raw) {
      const counts = spellings.get(key) ?? new Map<string, number>();
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
      spellings.set(key, counts);
    }
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      label: mostCommonSpelling(spellings.get(key)),
      ...totalsOf(group),
    }))
    .sort((a, b) => Number(b.value) - Number(a.value));
}

/** Adjustments by reason. `EXPIRATION` is money that expired on the shelf. */
export function adjustmentsByReason(
  movements: readonly SummarisableMovement[],
): AdjustmentTotals[] {
  const groups = new Map<AdjustmentReason, SummarisableMovement[]>();

  for (const movement of movements) {
    if (movement.source !== StockMovementSource.MANUAL_ADJUSTMENT) continue;
    if (!movement.adjustmentReason) continue;
    groups.set(movement.adjustmentReason, [
      ...(groups.get(movement.adjustmentReason) ?? []),
      movement,
    ]);
  }

  return [...groups.entries()]
    .map(([reason, group]) => ({ reason, ...totalsOf(group) }))
    .sort((a, b) => Number(b.value) - Number(a.value));
}

/**
 * Where the item closes the period. The opening balance comes from the
 * movements before it, never from `item.current_quantity` — that one is today's.
 */
export function itemPeriodBalance(
  openingBalance: Prisma.Decimal,
  movements: readonly SummarisableMovement[],
): {
  openingBalance: string;
  inbound: SummaryTotals;
  outbound: SummaryTotals;
  closingBalance: string;
} {
  const { inbound, outbound } = directionTotals(movements);
  const closing = openingBalance
    .plus(new Prisma.Decimal(inbound.quantity))
    .minus(new Prisma.Decimal(outbound.quantity));

  return {
    openingBalance: openingBalance.toString(),
    inbound,
    outbound,
    closingBalance: closing.toString(),
  };
}

/**
 * The spelling used most. Ties go to whichever came first — the sort is stable
 * and the map keeps insertion order. Alphabetical would prefer the unaccented
 * spelling, labelling the row with the typo.
 */
function mostCommonSpelling(counts: Map<string, number> | undefined): string {
  if (!counts || counts.size === 0) return UNNAMED_PROCEDURE;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
