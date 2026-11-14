import type { GeneralReportEntity } from '../../../../src/modules/reports/entities/general-report.entity';
import {
  generalReportDocument,
  generalReportFileName,
  NO_RECORDS_TEXT,
} from '../../../../src/modules/reports/pdf/general-report-document';

const owner = { name: 'Ana Souza', crmv: 'RS 12345' };

const financial = (
  months: number,
): GeneralReportEntity['sections'][number] => ({
  type: 'FINANCIAL',
  empty: false,
  income: {
    items: [{ origin: 'APPOINTMENTS', subtotal: '1800.00' }],
    total: '1800.00',
  },
  expenses: {
    items: [{ category: 'SUPPLIES', subtotal: '200.00' }],
    total: '200.00',
    professional: '200.00',
    personal: '0.00',
  },
  netBalance: '1600.00',
  months: Array.from({ length: months }, (_, index) => ({
    year: 2026,
    month: 10 + index,
    from: `2026-${10 + index}-01`,
    to: `2026-${10 + index}-28`,
    totalIncome: '900.00',
    totalExpenses: '100.00',
    netBalance: '800.00',
  })),
});

const report = (
  sections: GeneralReportEntity['sections'],
): GeneralReportEntity => ({
  period: { from: '2026-10-15', to: '2026-11-14' },
  sections,
  generatedAt: new Date('2026-11-11T23:20:00Z'),
});

/** Everything the document would print, as one string. */
const textOf = (node: unknown): string => JSON.stringify(node);

describe('generalReportFileName', () => {
  it('follows administranest_<report>_<period>.pdf', () => {
    expect(
      generalReportFileName({ from: '2026-10-15', to: '2026-11-14' }),
    ).toBe('administranest_relatorio-geral_2026-10-15_2026-11-14.pdf');
  });
});

describe('generalReportDocument', () => {
  it('puts the name, the CRMV, the title and the period in the header', () => {
    const header = textOf(generalReportDocument(report([]), owner).header);

    expect(header).toContain('Ana Souza');
    expect(header).toContain('CRMV RS 12345');
    expect(header).toContain('Relatório Geral');
    expect(header).toContain('15/10/2026 a 14/11/2026');
  });

  it('shows the name alone when the profile has no CRMV', () => {
    const header = textOf(
      generalReportDocument(report([]), { name: 'Ana Souza', crmv: null })
        .header,
    );

    expect(header).toContain('Ana Souza');
    expect(header).not.toContain('CRMV');
  });

  it('numbers the pages and dates the generation in the footer, in Brasília time', () => {
    const { footer } = generalReportDocument(report([]), owner);
    const text = textOf(
      typeof footer === 'function'
        ? footer(2, 5, { width: 0, height: 0 } as never)
        : footer,
    );

    expect(text).toContain('Página 2 de 5');
    expect(text).toContain('Gerado em 11/11/2026 20:20');
  });

  it('has only the selected sections, each one in the table of contents', () => {
    const document = generalReportDocument(
      report([
        financial(1),
        {
          type: 'TRIPS',
          empty: false,
          count: 2,
          distanceKm: '30.00',
          cost: '45.00',
        },
      ]),
      owner,
    );
    const headings = (
      document.content as { tocItem?: boolean; text?: string }[]
    )
      .filter(node => node.tocItem)
      .map(node => node.text);

    expect(headings).toEqual(['Financeiro', 'Deslocamento']);
    expect(textOf(document.content)).not.toContain('Atendimentos');
  });

  it('keeps an empty section, with a notice instead of its content', () => {
    const content = textOf(
      generalReportDocument(
        report([
          {
            type: 'SUPPLIERS',
            empty: true,
            items: [],
            invoiceCount: 0,
            total: '0.00',
          },
        ]),
        owner,
      ).content,
    );

    expect(content).toContain('Fornecedores');
    expect(content).toContain(NO_RECORDS_TEXT);
    expect(content).not.toContain('Valor total');
  });

  it('explains an hourly rate without goals instead of calling it empty', () => {
    const content = textOf(
      generalReportDocument(
        report([
          {
            type: 'HOURLY_RATE',
            empty: true,
            months: [{ year: 2026, month: 10, hourlyRate: null, source: null }],
            notice: 'PRICING_SETTINGS_NOT_FOUND',
          },
        ]),
        owner,
      ).content,
    );

    expect(content).toContain('metas da calculadora');
    expect(content).not.toContain(NO_RECORDS_TEXT);
  });

  it('draws the month-by-month chart only when the period has more than one month', () => {
    const one = textOf(generalReportDocument(report([financial(1)]), owner));
    const two = textOf(generalReportDocument(report([financial(2)]), owner));

    expect(one).not.toContain('<svg');
    expect(two).toContain('<svg');
    expect(two).toContain('Comparação mês a mês');
  });

  it('repeats table headers and never cuts a row at a page break', () => {
    const document = generalReportDocument(
      report([
        {
          type: 'APPOINTMENTS',
          empty: false,
          count: 1,
          billedTotal: '450.00',
          items: [
            {
              id: 'a-1',
              startsAt: new Date('2026-11-01T01:30:00Z'),
              patientName: 'Thor',
              asa: 'II',
              weightKg: '12.5',
              location: null,
              procedureName: 'Castração',
              amount: '450.00',
              clientName: null,
            },
          ],
        },
      ]),
      owner,
    );
    const tables = (
      document.content as {
        table?: { headerRows: number; dontBreakRows: boolean };
      }[]
    ).filter(node => node.table);

    expect(tables).toHaveLength(1);
    expect(tables[0].table).toMatchObject({
      headerRows: 1,
      dontBreakRows: true,
    });
    // 01:30Z on 1 November is still 31 October in Brasília.
    expect(textOf(document.content)).toContain('31/10/2026');
    // Intl puts a no-break space between the symbol and the amount.
    expect(textOf(document.content)).toMatch(/R\$\s450,00/);
  });
});
