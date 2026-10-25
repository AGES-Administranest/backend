import type { NfseResult } from './nfse-result';
import { GROSS_AMOUNT, ISSUE_DATE, NOTE_NUMBER } from './note-fields';
import { extractTaker } from './taker';
import { defined } from '../core/defined';
import { readLabeledField } from '../core/labeled-field';
import { TextLine } from '../core/text-lines';

export type NfseFields = Pick<
  NfseResult,
  'issueDate' | 'grossAmount' | 'number' | 'taker'
>;

/** Only the fields found: the review fills in the rest. */
export function extractNfseFields(
  lines: TextLine[],
  providerTaxId?: string,
): NfseFields {
  return {
    ...defined('issueDate', readLabeledField(lines, ISSUE_DATE)),
    ...defined('grossAmount', readLabeledField(lines, GROSS_AMOUNT)),
    ...defined('number', readLabeledField(lines, NOTE_NUMBER)),
    ...defined('taker', extractTaker(lines, providerTaxId)),
  };
}

export function hasAnyField(fields: NfseFields): boolean {
  return Object.values(fields).some(value => value !== undefined);
}
