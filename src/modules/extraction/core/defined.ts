/** `{ [key]: value }` to spread into a result, or nothing when the value is missing. */
export function defined<K extends string, V>(
  key: K,
  value: V | undefined,
): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
