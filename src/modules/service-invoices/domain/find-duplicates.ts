import { Prisma } from '@prisma/client';

export type DuplicateReason = 'SAME_AMOUNT_AND_DATE' | 'SAME_NUMBER_AND_TAKER';

/** The fields of a note that tell whether another one is the same. */
export type NoteIdentity = {
  amount: Prisma.Decimal | null;
  issueDate: Date | null;
  number: string | null;
  clientId: string | null;
  takerTaxId: string | null;
};

export type DuplicateCriteria = {
  amountAndDate?: { amount: Prisma.Decimal; issueDate: Date };
  numberAndTaker?: { number: string; clientId?: string; takerTaxId?: string };
};

/** Only what the note has filled in; null when there is nothing to compare. */
export function duplicateCriteria(
  note: NoteIdentity,
): DuplicateCriteria | null {
  const criteria: DuplicateCriteria = {
    ...(note.amount !== null &&
      note.issueDate && {
        amountAndDate: { amount: note.amount, issueDate: note.issueDate },
      }),
    ...(note.number &&
      (note.clientId || note.takerTaxId) && {
        numberAndTaker: {
          number: note.number,
          ...(note.clientId && { clientId: note.clientId }),
          ...(note.takerTaxId && { takerTaxId: note.takerTaxId }),
        },
      }),
  };
  return Object.keys(criteria).length > 0 ? criteria : null;
}

/** Amount and date first: it is the case the acceptance criteria name. */
export function duplicateReason(
  note: NoteIdentity,
  duplicate: NoteIdentity,
): DuplicateReason {
  const sameAmount =
    note.amount !== null &&
    duplicate.amount !== null &&
    note.amount.equals(duplicate.amount);
  const sameDate =
    note.issueDate !== null &&
    note.issueDate.getTime() === duplicate.issueDate?.getTime();
  return sameAmount && sameDate
    ? 'SAME_AMOUNT_AND_DATE'
    : 'SAME_NUMBER_AND_TAKER';
}
