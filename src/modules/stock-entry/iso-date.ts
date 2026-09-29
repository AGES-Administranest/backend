/** `@db.Date` columns travel as `YYYY-MM-DD`, read and written at UTC midnight. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fromIsoDate(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
}
