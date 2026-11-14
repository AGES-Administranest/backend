import {
  REPORT_SECTIONS,
  selectedSections,
} from '../../../../src/modules/reports/domain/report-sections';
import { DomainError } from '../../../../src/shared/errors/domain-error';

describe('selectedSections', () => {
  it('selects every section when none is asked', () => {
    expect(selectedSections(undefined)).toEqual([...REPORT_SECTIONS]);
  });

  it('keeps the order of the document and drops repetitions', () => {
    expect(
      selectedSections(['HOURLY_RATE', 'FINANCIAL', 'TRIPS', 'FINANCIAL']),
    ).toEqual(['FINANCIAL', 'TRIPS', 'HOURLY_RATE']);
  });

  it('refuses an empty selection with its own code', () => {
    let error: unknown;
    try {
      selectedSections([]);
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({
      kind: 'INVALID_INPUT',
      code: 'REPORT_SECTIONS_EMPTY',
    });
  });
});
