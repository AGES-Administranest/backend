import { BUSINESS_TIME_ZONE } from '../../../shared/dates/period';

// What the document shows is written for the user, in Brazilian Portuguese.

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

/** `"1234.50"` as `R$ 1.234,50`. */
export function brl(value: string): string {
  return currency.format(Number(value));
}

/** `"312.40"` as `312,4`. */
export function quantity(value: string): string {
  return decimal.format(Number(value));
}

/** `2026-10-15` as `15/10/2026`. */
export function day(isoDate: string): string {
  const [year, month, date] = isoDate.split('-');
  return `${date}/${month}/${year}`;
}

/** An instant as the day it was in Brasília, `15/10/2026`. */
export function localDay(instant: Date): string {
  return instant.toLocaleDateString('pt-BR', { timeZone: BUSINESS_TIME_ZONE });
}

/** An instant as `15/10/2026 18:30`, in Brasília. */
export function localDateTime(instant: Date): string {
  return instant
    .toLocaleString('pt-BR', {
      timeZone: BUSINESS_TIME_ZONE,
      dateStyle: 'short',
      timeStyle: 'short',
    })
    .replace(',', '');
}

const MONTHS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/** `{ year: 2026, month: 10 }` as `out/2026`. */
export function monthLabel({
  year,
  month,
}: {
  year: number;
  month: number;
}): string {
  return `${MONTHS[month - 1]}/${year}`;
}
