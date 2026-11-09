import { Prisma } from '@prisma/client';

export type RequiredField = 'issueDate' | 'amount' | 'clientId';

export type ConfirmableNote = {
  issueDate: Date | null;
  amount: Prisma.Decimal | null;
  clientId: string | null;
};

export type ReadyNote<Note extends ConfirmableNote> = Note & {
  issueDate: Date;
  amount: Prisma.Decimal;
  clientId: string;
};

/** What a confirmed note cannot go without: its income entry needs them. */
export function missingForConfirmation(note: ConfirmableNote): RequiredField[] {
  const missing: RequiredField[] = [];
  if (!note.issueDate) missing.push('issueDate');
  if (!note.amount || note.amount.lte(0)) missing.push('amount');
  if (!note.clientId) missing.push('clientId');
  return missing;
}

/** The client's payment terms counted from the issue date, at UTC midnight. */
export function dueDateOf(
  issueDate: Date,
  paymentTermsDays: number | null,
): Date | null {
  if (paymentTermsDays === null) return null;

  const dueDate = new Date(issueDate);
  dueDate.setUTCDate(dueDate.getUTCDate() + paymentTermsDays);
  return dueDate;
}
