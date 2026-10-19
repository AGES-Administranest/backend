/**
 * quantity × unitValue ≈ totalValue (D11). Tolerance: half a cent per unit (a
 * unit price rounded to the cent), never under one cent.
 */
export function checkLine(
  quantity: number | undefined,
  unitValue: number | undefined,
  totalValue: number | undefined,
): boolean {
  if (
    quantity === undefined ||
    unitValue === undefined ||
    totalValue === undefined
  ) {
    return false;
  }
  const tolerance = Math.max(0.01, 0.005 * Math.abs(quantity));
  return Math.abs(quantity * unitValue - totalValue) <= tolerance + 1e-9;
}
