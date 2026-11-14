import { Injectable } from '@nestjs/common';

import { money, sum } from './format';
import { ReportContext } from './report-context';
import { StockEntryService } from '../../stock-entry';
import { StockMovementsService } from '../../stock-movements';
import { SupplierService } from '../../supplier';
import {
  StockReportSection,
  SuppliersReportSection,
} from '../entities/general-report.entity';

/** How the report names the purchases that have no supplier. */
export const NO_SUPPLIER_LABEL = 'Sem fornecedor';

/** Stock and Supplies, and Suppliers sections (US29). */
@Injectable()
export class StockSectionBuilder {
  constructor(
    private readonly stockMovements: StockMovementsService,
    private readonly purchases: StockEntryService,
    private readonly suppliers: SupplierService,
  ) {}

  async stockSection(context: ReportContext): Promise<StockReportSection> {
    const [consumption, purchases] = await Promise.all([
      this.stockMovements.consumptionInPeriod(context.userId, context.period),
      this.purchases.purchaseTotalsInPeriod(context.userId, context.period),
    ]);

    return {
      type: 'STOCK',
      empty: consumption.length === 0 && purchases.count === 0,
      consumption: {
        items: consumption.map(item => ({
          itemId: item.itemId,
          itemName: item.itemName,
          unit: item.unit,
          quantity: item.quantity.toString(),
          cost: money(item.cost),
        })),
        totalCost: money(sum(consumption.map(item => item.cost))),
      },
      purchases: {
        invoiceCount: purchases.count,
        total: money(purchases.total),
      },
    };
  }

  async suppliersSection(
    context: ReportContext,
  ): Promise<SuppliersReportSection> {
    const rows = await this.purchases.purchaseTotalsBySupplierInPeriod(
      context.userId,
      context.period,
    );
    const names = await this.suppliers.findNames(
      context.userId,
      rows.map(row => row.supplierId).filter((id): id is string => id !== null),
    );

    const items = rows
      .map(row => ({
        supplierId: row.supplierId,
        supplierName:
          row.supplierId === null
            ? NO_SUPPLIER_LABEL
            : (names.get(row.supplierId) ?? NO_SUPPLIER_LABEL),
        invoiceCount: row.count,
        total: money(row.total),
      }))
      .sort(
        (a, b) =>
          Number(b.total) - Number(a.total) ||
          a.supplierName.localeCompare(b.supplierName, 'pt-BR'),
      );

    return {
      type: 'SUPPLIERS',
      empty: rows.length === 0,
      items,
      invoiceCount: rows.reduce((n, row) => n + row.count, 0),
      total: money(sum(rows.map(row => row.total))),
    };
  }
}
