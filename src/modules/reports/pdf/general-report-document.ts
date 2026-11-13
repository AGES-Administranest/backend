import type {
  Content,
  ContentTable,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';

import { barChartSvg } from './bar-chart';
import {
  brl,
  day,
  localDateTime,
  localDay,
  monthLabel,
  quantity,
} from './format';
import type { ExpenseGroup, IncomeOrigin } from '../../financial';
import type { ReportSection } from '../domain/report-sections';
import type {
  AppointmentsReportSection,
  ClientsReportSection,
  DepreciationReportSection,
  FinancialReportSection,
  GeneralReportEntity,
  GeneralReportSection,
  HourlyRateReportSection,
  StockReportSection,
  SuppliersReportSection,
  TripsReportSection,
} from '../entities/general-report.entity';

// The layout of the general report PDF (US28). It only arranges what
// `GeneralReportService` already computed: no number is calculated here.
// The texts are what the user reads, so they are in Brazilian Portuguese.

export const REPORT_TITLE = 'Relatório Geral';
export const NO_RECORDS_TEXT = 'Sem registros no período.';

export const SECTION_TITLES: Record<ReportSection, string> = {
  FINANCIAL: 'Financeiro',
  APPOINTMENTS: 'Atendimentos',
  CLIENTS: 'Clínicas',
  STOCK: 'Estoque e Insumos',
  SUPPLIERS: 'Fornecedores',
  TRIPS: 'Deslocamento',
  DEPRECIATION: 'Depreciação',
  HOURLY_RATE: 'Hora Trabalhada',
};

const INCOME_LABELS: Record<IncomeOrigin, string> = {
  APPOINTMENTS: 'Procedimentos realizados',
  SERVICE_INVOICES: 'Notas fiscais emitidas',
  OTHER: 'Outras entradas',
};

const EXPENSE_LABELS: Record<ExpenseGroup, string> = {
  SUPPLIES: 'Insumos',
  TRAVEL: 'Deslocamento',
  FIXED_COSTS: 'Custos fixos',
  DEPRECIATION: 'Depreciação',
  TAXES_AND_FEES: 'Impostos e taxas',
  OTHER: 'Outros',
};

const UNIT_LABELS: Record<string, string> = {
  UNIT: 'un',
  AMPOULE: 'amp',
  VIAL: 'fr',
  BOX: 'cx',
  ML: 'mL',
  MG: 'mg',
  GRAM: 'g',
  TABLET: 'comp',
  LITER: 'L',
  MICROGRAM: 'mcg',
  MG_PER_ML: 'mg/mL',
  MCG_PER_ML: 'mcg/mL',
};

const INCOME_COLOR = '#2e7d5b';
const EXPENSE_COLOR = '#c0504d';
const MUTED = '#666666';
const HEADER_FILL = '#eeeeee';

/** Who the report belongs to, for the header (US28). */
export interface ReportOwner {
  name: string;
  /** Null while the profile has no CRMV: the header then shows the name only. */
  crmv: string | null;
}

/** `administranest_relatorio-geral_2026-10-15_2026-11-14.pdf` (US28). */
export function generalReportFileName(period: {
  from: string;
  to: string;
}): string {
  return `administranest_relatorio-geral_${period.from}_${period.to}.pdf`;
}

const right = (text: string, extra: object = {}): TableCell => ({
  text,
  alignment: 'right',
  ...extra,
});
const head = (
  text: string,
  alignment: 'left' | 'right' = 'left',
): TableCell => ({
  text,
  bold: true,
  fillColor: HEADER_FILL,
  alignment,
});
const totalRow = (cells: TableCell[]): TableCell[] =>
  cells.map(cell =>
    typeof cell === 'string'
      ? { text: cell, bold: true }
      : ({ ...(cell as object), bold: true } as TableCell),
  );
const dash = (value: string | null | undefined): string => value?.trim() || '—';

/**
 * A table whose header repeats on every page and whose rows are never cut in
 * two by a page break (US28).
 */
function table(
  widths: (string | number)[],
  header: TableCell[],
  rows: TableCell[][],
): ContentTable {
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths,
      body: [header, ...rows],
    },
    layout: 'lightHorizontalLines',
    fontSize: 9,
    margin: [0, 4, 0, 10],
  };
}

const subtitle = (text: string): Content => ({
  text,
  bold: true,
  fontSize: 10,
  margin: [0, 6, 0, 0],
});

const figures = (pairs: [string, string][]): Content => ({
  columns: pairs.map(([label, value]) => ({
    stack: [
      { text: label, fontSize: 8, color: MUTED },
      { text: value, fontSize: 12, bold: true },
    ],
  })),
  margin: [0, 4, 0, 10],
});

function financial(section: FinancialReportSection): Content[] {
  const content: Content[] = [
    subtitle('Entradas'),
    table(
      ['*', 90],
      [head('Origem'), head('Subtotal', 'right')],
      [
        ...section.income.items.map(item => [
          INCOME_LABELS[item.origin],
          right(brl(item.subtotal)),
        ]),
        totalRow(['Total de entradas', right(brl(section.income.total))]),
      ],
    ),
    subtitle('Saídas'),
    table(
      ['*', 90],
      [head('Categoria'), head('Subtotal', 'right')],
      [
        ...section.expenses.items.map(item => [
          EXPENSE_LABELS[item.category],
          right(brl(item.subtotal)),
        ]),
        totalRow(['Total de saídas', right(brl(section.expenses.total))]),
      ],
    ),
    {
      table: {
        widths: ['*', 110],
        body: [
          [
            { text: 'Resultado líquido do período', bold: true, fontSize: 11 },
            right(brl(section.netBalance), { bold: true, fontSize: 13 }),
          ],
        ],
      },
      layout: 'noBorders',
      fillColor: HEADER_FILL,
      margin: [0, 2, 0, 10],
    },
  ];

  if (section.months.length > 1) {
    content.push(
      subtitle('Comparação mês a mês'),
      {
        svg: barChartSvg(
          section.months.map(month => ({
            label: monthLabel(month),
            values: [Number(month.totalIncome), Number(month.totalExpenses)],
          })),
          [
            { name: 'Entradas', color: INCOME_COLOR },
            { name: 'Saídas', color: EXPENSE_COLOR },
          ],
        ),
        width: 500,
        margin: [0, 6, 0, 0],
      },
      table(
        ['*', 80, 80, 80],
        [
          head('Mês'),
          head('Entradas', 'right'),
          head('Saídas', 'right'),
          head('Resultado', 'right'),
        ],
        section.months.map(month => [
          `${monthLabel(month)} (${day(month.from)} a ${day(month.to)})`,
          right(brl(month.totalIncome)),
          right(brl(month.totalExpenses)),
          right(brl(month.netBalance)),
        ]),
      ),
    );
  }

  return content;
}

function appointments(section: AppointmentsReportSection): Content[] {
  return [
    figures([
      ['Atendimentos realizados', String(section.count)],
      ['Valor total faturado', brl(section.billedTotal)],
    ]),
    table(
      [48, '*', 26, 44, 90, 82, 58],
      [
        head('Data'),
        head('Paciente'),
        head('ASA'),
        head('Peso (kg)', 'right'),
        head('Local'),
        head('Procedimento'),
        head('Valor', 'right'),
      ],
      section.items.map(item => [
        localDay(item.startsAt),
        dash(item.patientName),
        dash(item.asa),
        right(item.weightKg ? quantity(item.weightKg) : '—'),
        dash(item.location),
        dash(item.procedureName),
        right(item.amount ? brl(item.amount) : '—'),
      ]),
    ),
  ];
}

function clients(section: ClientsReportSection): Content[] {
  return [
    table(
      ['*', 68, 80, 74, 80],
      [
        head('Tomador de serviço'),
        head('Atendimentos', 'right'),
        head('Faturado', 'right'),
        head('Deslocamentos', 'right'),
        head('Custo de desloc.', 'right'),
      ],
      [
        ...section.items.map(item => [
          item.clientName,
          right(String(item.appointmentsCount)),
          right(brl(item.billedTotal)),
          right(String(item.tripCount)),
          right(brl(item.tripCost)),
        ]),
        totalRow([
          'Total',
          right(String(section.appointmentsCount)),
          right(brl(section.billedTotal)),
          right(''),
          right(brl(section.tripCost)),
        ]),
      ],
    ),
  ];
}

function stock(section: StockReportSection): Content[] {
  const { consumption, purchases } = section;
  return [
    subtitle('Consumo nos atendimentos'),
    consumption.items.length === 0
      ? {
          text: NO_RECORDS_TEXT,
          italics: true,
          color: MUTED,
          margin: [0, 4, 0, 10],
        }
      : table(
          ['*', 90, 90],
          [head('Item'), head('Quantidade', 'right'), head('Custo', 'right')],
          [
            ...consumption.items.map(item => [
              item.itemName,
              right(
                `${quantity(item.quantity)} ${UNIT_LABELS[item.unit] ?? ''}`.trim(),
              ),
              right(brl(item.cost)),
            ]),
            totalRow([
              'Custo total do consumo',
              right(''),
              right(brl(consumption.totalCost)),
            ]),
          ],
        ),
    subtitle('Compras de insumos'),
    figures([
      ['Notas de compra', String(purchases.invoiceCount)],
      ['Valor total comprado', brl(purchases.total)],
    ]),
  ];
}

function suppliers(section: SuppliersReportSection): Content[] {
  return [
    table(
      ['*', 80, 100],
      [
        head('Fornecedor'),
        head('Notas', 'right'),
        head('Valor total', 'right'),
      ],
      [
        ...section.items.map(item => [
          item.supplierName,
          right(String(item.invoiceCount)),
          right(brl(item.total)),
        ]),
        totalRow([
          'Total',
          right(String(section.invoiceCount)),
          right(brl(section.total)),
        ]),
      ],
    ),
  ];
}

function trips(section: TripsReportSection): Content[] {
  return [
    figures([
      ['Deslocamentos', String(section.count)],
      ['Quilômetros rodados', `${quantity(section.distanceKm)} km`],
      ['Custo de deslocamento', brl(section.cost)],
    ]),
  ];
}

function depreciation(section: DepreciationReportSection): Content[] {
  return [
    table(
      ['*', 70, 110, 100],
      [
        head('Mês'),
        head('Dias no período', 'right'),
        head('Depreciação do mês', 'right'),
        head('No período', 'right'),
      ],
      [
        ...section.months.map(month => [
          monthLabel(month),
          right(`${month.days} de ${month.daysInMonth}`),
          right(brl(month.monthlyDepreciation)),
          right(brl(month.amount)),
        ]),
        totalRow([
          'Depreciação acumulada no período',
          right(''),
          right(''),
          right(brl(section.total)),
        ]),
      ],
    ),
  ];
}

function hourlyRate(section: HourlyRateReportSection): Content[] {
  const content: Content[] = [];
  if (section.notice === 'PRICING_SETTINGS_NOT_FOUND') {
    content.push({
      text: 'As metas da calculadora ainda não foram configuradas; por isso alguns meses não têm valor da hora.',
      italics: true,
      color: MUTED,
      margin: [0, 4, 0, 0],
    });
  }
  content.push(
    table(
      ['*', 120],
      [head('Mês'), head('Valor da hora', 'right')],
      section.months.map(month => [
        monthLabel(month),
        right(month.hourlyRate ? brl(month.hourlyRate) : '—'),
      ]),
    ),
  );
  return content;
}

function bodyOf(section: GeneralReportSection): Content[] {
  switch (section.type) {
    case 'FINANCIAL':
      return financial(section);
    case 'APPOINTMENTS':
      return appointments(section);
    case 'CLIENTS':
      return clients(section);
    case 'STOCK':
      return stock(section);
    case 'SUPPLIERS':
      return suppliers(section);
    case 'TRIPS':
      return trips(section);
    case 'DEPRECIATION':
      return depreciation(section);
    case 'HOURLY_RATE':
      return hourlyRate(section);
  }
}

/**
 * The hourly rate section is the one that still has something to say when it
 * is empty: why the months have no value.
 */
function sectionContent(section: GeneralReportSection): Content[] {
  if (!section.empty) return bodyOf(section);
  if (section.type === 'HOURLY_RATE' && section.notice) return bodyOf(section);
  return [
    {
      text: NO_RECORDS_TEXT,
      italics: true,
      color: MUTED,
      margin: [0, 4, 0, 10],
    },
  ];
}

/**
 * The general report as a pdfmake document.
 *
 * - Header on every page: name, CRMV, report title and period.
 * - Footer on every page: when it was generated and "Página X de Y".
 * - A table of contents with only the sections of this report, which is also
 *   how the document states its scope (US29).
 * - A selected section without records is shown with a notice, never dropped.
 */
export function generalReportDocument(
  report: GeneralReportEntity,
  owner: ReportOwner,
): TDocumentDefinitions {
  const period = `${day(report.period.from)} a ${day(report.period.to)}`;
  const generatedAt = localDateTime(report.generatedAt);

  return {
    pageSize: 'A4',
    pageMargins: [40, 80, 40, 50],
    info: {
      title: `${REPORT_TITLE} — ${period}`,
      author: owner.name,
      creator: 'AdministraNest',
    },
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    header: {
      margin: [40, 28, 40, 0],
      columns: [
        {
          stack: [
            { text: owner.name, bold: true, fontSize: 11 },
            ...(owner.crmv
              ? [{ text: `CRMV ${owner.crmv}`, fontSize: 9, color: MUTED }]
              : []),
          ],
        },
        {
          stack: [
            {
              text: REPORT_TITLE,
              bold: true,
              fontSize: 11,
              alignment: 'right',
            },
            { text: period, fontSize: 9, color: MUTED, alignment: 'right' },
          ],
        },
      ],
    },
    footer: (currentPage, pageCount) => ({
      margin: [40, 16, 40, 0],
      fontSize: 8,
      color: MUTED,
      columns: [
        `Gerado em ${generatedAt}`,
        { text: `Página ${currentPage} de ${pageCount}`, alignment: 'right' },
      ],
    }),
    content: [
      {
        toc: {
          title: { text: 'Seções deste relatório', bold: true, fontSize: 12 },
        },
        margin: [0, 0, 0, 16],
      },
      ...report.sections.flatMap((section): Content[] => [
        {
          text: SECTION_TITLES[section.type],
          fontSize: 14,
          bold: true,
          tocItem: true,
          margin: [0, 10, 0, 4],
        },
        ...sectionContent(section),
      ]),
    ],
  };
}
