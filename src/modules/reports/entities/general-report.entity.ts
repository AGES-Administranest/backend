import { ApiProperty, getSchemaPath } from '@nestjs/swagger';

import {
  EXPENSE_GROUPS,
  type ExpenseGroup,
  INCOME_ORIGINS,
  type IncomeOrigin,
} from '../../financial';
import { REPORT_SECTIONS, type ReportSection } from '../domain/report-sections';

// Money and quantities travel as strings (decimals never go through floats).

const money = (example: string, description?: string) =>
  ApiProperty({ type: String, example, description });

abstract class ReportSectionBase {
  @ApiProperty({
    description:
      'True when the period has no record for this section. The section is still sent, so the document can say so instead of leaving it out.',
  })
  empty!: boolean;
}

// ----------------------------------------------------------------- financial

export class IncomeByOriginItem {
  @ApiProperty({
    enum: INCOME_ORIGINS,
    example: 'APPOINTMENTS',
    description:
      'APPOINTMENTS: procedures done; SERVICE_INVOICES: invoices issued; OTHER: posted by hand',
  })
  origin!: IncomeOrigin;

  @money('3200.00')
  subtotal!: string;
}

export class ReportIncome {
  @ApiProperty({ type: IncomeByOriginItem, isArray: true })
  items!: IncomeByOriginItem[];

  @money('4100.00')
  total!: string;
}

export class ReportExpenseItem {
  @ApiProperty({ enum: EXPENSE_GROUPS, example: 'SUPPLIES' })
  category!: ExpenseGroup;

  @money('640.00')
  subtotal!: string;
}

export class ReportExpenses {
  @ApiProperty({ type: ReportExpenseItem, isArray: true })
  items!: ReportExpenseItem[];

  @money('1850.00')
  total!: string;

  @money('1500.00')
  professional!: string;

  @money('350.00')
  personal!: string;
}

export class FinancialMonth {
  @ApiProperty({ example: 2026 })
  year!: number;

  @ApiProperty({ example: 10, minimum: 1, maximum: 12 })
  month!: number;

  @ApiProperty({
    example: '2026-10-15',
    format: 'date',
    description: 'First day of the period in this month',
  })
  from!: string;

  @ApiProperty({
    example: '2026-10-31',
    format: 'date',
    description: 'Last day of the period in this month',
  })
  to!: string;

  @money('2100.00')
  totalIncome!: string;

  @money('900.00')
  totalExpenses!: string;

  @money('1200.00')
  netBalance!: string;
}

export class FinancialReportSection extends ReportSectionBase {
  @ApiProperty({ enum: ['FINANCIAL'] })
  type!: 'FINANCIAL';

  @ApiProperty({ type: ReportIncome })
  income!: ReportIncome;

  @ApiProperty({
    type: ReportExpenses,
    description:
      'By the statement rule. Depreciation is computed per month and, in a month the period covers only in part, by the share of its days.',
  })
  expenses!: ReportExpenses;

  @money('2250.00')
  netBalance!: string;

  @ApiProperty({
    type: FinancialMonth,
    isArray: true,
    description:
      'One item per calendar month the period touches. With more than one, the app shows the month-by-month comparison.',
  })
  months!: FinancialMonth[];
}

// -------------------------------------------------------------- appointments

export class ReportAppointmentItem {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startsAt!: Date;

  @ApiProperty({ type: String, nullable: true, example: 'Thor' })
  patientName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'II' })
  asa!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '12.5' })
  weightKg!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Rua das Flores, 100, Porto Alegre, RS',
    description:
      "The appointment's location; without one, the client's address",
  })
  location!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Castração' })
  procedureName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '450.00' })
  amount!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Clínica Pampa' })
  clientName!: string | null;
}

export class AppointmentsReportSection extends ReportSectionBase {
  @ApiProperty({ enum: ['APPOINTMENTS'] })
  type!: 'APPOINTMENTS';

  @ApiProperty({
    type: ReportAppointmentItem,
    isArray: true,
    description: 'Completed appointments of the period, oldest first',
  })
  items!: ReportAppointmentItem[];

  @ApiProperty({ example: 14 })
  count!: number;

  @money('5300.00', 'An appointment without an amount adds nothing')
  billedTotal!: string;
}

// ------------------------------------------------------------------- clients

export class ReportClientItem {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  clientId!: string | null;

  @ApiProperty({
    example: 'Clínica Pampa',
    description: 'Records without a client are grouped as "Sem tomador"',
  })
  clientName!: string;

  @ApiProperty({ example: 6 })
  appointmentsCount!: number;

  @money('2700.00')
  billedTotal!: string;

  @ApiProperty({ example: 4 })
  tripCount!: number;

  @money('96.50')
  tripCost!: string;
}

export class ClientsReportSection extends ReportSectionBase {
  @ApiProperty({ enum: ['CLIENTS'] })
  type!: 'CLIENTS';

  @ApiProperty({
    type: ReportClientItem,
    isArray: true,
    description:
      'By client, highest billing first. Same numbers as the client summary (US17) for the same period.',
  })
  items!: ReportClientItem[];

  @ApiProperty({ example: 14 })
  appointmentsCount!: number;

  @money('5300.00')
  billedTotal!: string;

  @money('210.00')
  tripCost!: string;
}

// --------------------------------------------------------------------- stock

export class ReportConsumptionItem {
  @ApiProperty({ format: 'uuid' })
  itemId!: string;

  @ApiProperty({ example: 'Propofol 1%' })
  itemName!: string;

  @ApiProperty({ example: 'MILLILITER' })
  unit!: string;

  @ApiProperty({ type: String, example: '120' })
  quantity!: string;

  @money('84.00')
  cost!: string;
}

export class ReportConsumption {
  @ApiProperty({
    type: ReportConsumptionItem,
    isArray: true,
    description:
      'What the procedures used, net of corrections, most expensive first. Losses and manual adjustments are not consumption.',
  })
  items!: ReportConsumptionItem[];

  @money('312.40')
  totalCost!: string;
}

export class ReportPurchases {
  @ApiProperty({
    example: 3,
    description: 'Confirmed purchase invoices issued in the period',
  })
  invoiceCount!: number;

  @money('1450.00', 'An invoice without a total adds nothing')
  total!: string;
}

export class StockReportSection extends ReportSectionBase {
  @ApiProperty({ enum: ['STOCK'] })
  type!: 'STOCK';

  @ApiProperty({ type: ReportConsumption })
  consumption!: ReportConsumption;

  @ApiProperty({ type: ReportPurchases })
  purchases!: ReportPurchases;
}

// ----------------------------------------------------------------- suppliers

export class ReportSupplierItem {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  supplierId!: string | null;

  @ApiProperty({
    example: 'Distribuidora Vet Sul',
    description: 'Invoices without a supplier are grouped as "Sem fornecedor"',
  })
  supplierName!: string;

  @ApiProperty({ example: 2 })
  invoiceCount!: number;

  @money('980.00')
  total!: string;
}

export class SuppliersReportSection extends ReportSectionBase {
  @ApiProperty({ enum: ['SUPPLIERS'] })
  type!: 'SUPPLIERS';

  @ApiProperty({
    type: ReportSupplierItem,
    isArray: true,
    description: 'Confirmed purchases by supplier, highest total first',
  })
  items!: ReportSupplierItem[];

  @ApiProperty({ example: 3 })
  invoiceCount!: number;

  @money('1450.00')
  total!: string;
}

// --------------------------------------------------------------------- trips

export class TripsReportSection extends ReportSectionBase {
  @ApiProperty({ enum: ['TRIPS'] })
  type!: 'TRIPS';

  @ApiProperty({ example: 9 })
  count!: number;

  @ApiProperty({
    type: String,
    example: '312.40',
    description: 'A ride without a distance adds nothing',
  })
  distanceKm!: string;

  @money('210.00')
  cost!: string;
}

// -------------------------------------------------------------- depreciation

export class DepreciationMonth {
  @ApiProperty({ example: 2026 })
  year!: number;

  @ApiProperty({ example: 10, minimum: 1, maximum: 12 })
  month!: number;

  @ApiProperty({ example: 17, description: 'Days of the period in the month' })
  days!: number;

  @ApiProperty({ example: 31 })
  daysInMonth!: number;

  @money('155.00', 'Depreciation of the whole month (US15)')
  monthlyDepreciation!: string;

  @money('85.00', 'monthlyDepreciation × days / daysInMonth')
  amount!: string;
}

export class DepreciationReportSection extends ReportSectionBase {
  @ApiProperty({ enum: ['DEPRECIATION'] })
  type!: 'DEPRECIATION';

  @ApiProperty({ type: DepreciationMonth, isArray: true })
  months!: DepreciationMonth[];

  @money('155.00', 'Depreciation accumulated over the period')
  total!: string;
}

// --------------------------------------------------------------- hourly rate

export const HOURLY_RATE_SOURCES = ['HISTORY', 'CALCULATED'] as const;
export type HourlyRateSource = (typeof HOURLY_RATE_SOURCES)[number];

export class HourlyRateMonth {
  @ApiProperty({ example: 2026 })
  year!: number;

  @ApiProperty({ example: 10, minimum: 1, maximum: 12 })
  month!: number;

  @ApiProperty({ type: String, nullable: true, example: '187.50' })
  hourlyRate!: string | null;

  @ApiProperty({
    enum: HOURLY_RATE_SOURCES,
    nullable: true,
    description:
      'HISTORY: the stored value of a past month (US22); CALCULATED: calculated now from the current goals (US20) and not stored, for the current month, a future one or a month never stored. Null when there is no value.',
  })
  source!: HourlyRateSource | null;
}

export class HourlyRateReportSection extends ReportSectionBase {
  @ApiProperty({ enum: ['HOURLY_RATE'] })
  type!: 'HOURLY_RATE';

  @ApiProperty({ type: HourlyRateMonth, isArray: true })
  months!: HourlyRateMonth[];

  @ApiProperty({
    type: String,
    enum: ['PRICING_SETTINGS_NOT_FOUND'],
    nullable: true,
    description:
      'PRICING_SETTINGS_NOT_FOUND: the goals (US19) were never saved, so months without a stored value have none',
  })
  notice!: 'PRICING_SETTINGS_NOT_FOUND' | null;
}

// -------------------------------------------------------------------- report

export type GeneralReportSection =
  | FinancialReportSection
  | AppointmentsReportSection
  | ClientsReportSection
  | StockReportSection
  | SuppliersReportSection
  | TripsReportSection
  | DepreciationReportSection
  | HourlyRateReportSection;

export const SECTION_MODELS = {
  FINANCIAL: FinancialReportSection,
  APPOINTMENTS: AppointmentsReportSection,
  CLIENTS: ClientsReportSection,
  STOCK: StockReportSection,
  SUPPLIERS: SuppliersReportSection,
  TRIPS: TripsReportSection,
  DEPRECIATION: DepreciationReportSection,
  HOURLY_RATE: HourlyRateReportSection,
} as const satisfies Record<ReportSection, unknown>;

export class ReportPeriod {
  @ApiProperty({ example: '2026-10-15', format: 'date' })
  from!: string;

  @ApiProperty({ example: '2026-11-14', format: 'date' })
  to!: string;
}

export class GeneralReportEntity {
  @ApiProperty({ type: ReportPeriod })
  period!: ReportPeriod;

  @ApiProperty({
    type: 'array',
    items: {
      oneOf: REPORT_SECTIONS.map(section => ({
        $ref: getSchemaPath(SECTION_MODELS[section]),
      })),
      discriminator: {
        propertyName: 'type',
        mapping: Object.fromEntries(
          REPORT_SECTIONS.map(section => [
            section,
            getSchemaPath(SECTION_MODELS[section]),
          ]),
        ),
      },
    },
    description:
      'Only the selected sections, always in the order of the document. Their `type` values are the scope of the report.',
  })
  sections!: GeneralReportSection[];

  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: Date;
}
