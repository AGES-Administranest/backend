import { Prisma } from '@prisma/client';

import { ReportContext } from '../../../../src/modules/reports/general-report/report-context';
import {
  NO_SUPPLIER_LABEL,
  StockSectionBuilder,
} from '../../../../src/modules/reports/general-report/stock-section.builder';

const d = (value: string | number) => new Prisma.Decimal(value);

describe('StockSectionBuilder', () => {
  const context = new ReportContext('user-1', '2026-10-01', '2026-10-31', {
    monthlyDepreciation: jest.fn(),
  } as never);

  const build = () => {
    const stockMovements = {
      consumptionInPeriod: jest.fn().mockResolvedValue([]),
    };
    const purchases = {
      purchaseTotalsInPeriod: jest
        .fn()
        .mockResolvedValue({ count: 0, total: d(0) }),
      purchaseTotalsBySupplierInPeriod: jest.fn().mockResolvedValue([]),
    };
    const suppliers = { findNames: jest.fn().mockResolvedValue(new Map()) };
    const builder = new StockSectionBuilder(
      stockMovements as never,
      purchases as never,
      suppliers as never,
    );
    return { builder, stockMovements, purchases, suppliers };
  };

  it('shows the consumption by item and the purchases of the period', async () => {
    const { builder, stockMovements, purchases } = build();
    stockMovements.consumptionInPeriod.mockResolvedValue([
      {
        itemId: 'i-1',
        itemName: 'Propofol 1%',
        unit: 'MILLILITER',
        quantity: d('120'),
        cost: d('84'),
      },
      {
        itemId: 'i-2',
        itemName: 'Seringa 3 mL',
        unit: 'UNIT',
        quantity: d('10'),
        cost: d('6.5'),
      },
    ]);
    purchases.purchaseTotalsInPeriod.mockResolvedValue({
      count: 3,
      total: d('1450'),
    });

    const section = await builder.stockSection(context);

    expect(stockMovements.consumptionInPeriod).toHaveBeenCalledWith(
      'user-1',
      context.period,
    );
    expect(section).toEqual({
      type: 'STOCK',
      empty: false,
      consumption: {
        items: [
          {
            itemId: 'i-1',
            itemName: 'Propofol 1%',
            unit: 'MILLILITER',
            quantity: '120',
            cost: '84.00',
          },
          {
            itemId: 'i-2',
            itemName: 'Seringa 3 mL',
            unit: 'UNIT',
            quantity: '10',
            cost: '6.50',
          },
        ],
        totalCost: '90.50',
      },
      purchases: { invoiceCount: 3, total: '1450.00' },
    });
  });

  it('is empty without consumption and without purchases', async () => {
    const { builder } = build();
    expect((await builder.stockSection(context)).empty).toBe(true);
  });

  it('groups the purchases by supplier, highest total first', async () => {
    const { builder, purchases, suppliers } = build();
    purchases.purchaseTotalsBySupplierInPeriod.mockResolvedValue([
      { supplierId: 's-1', count: 1, total: d('300') },
      { supplierId: null, count: 1, total: d('170') },
      { supplierId: 's-2', count: 2, total: d('980') },
    ]);
    suppliers.findNames.mockResolvedValue(
      new Map([
        ['s-1', 'Vet Norte'],
        ['s-2', 'Distribuidora Vet Sul'],
      ]),
    );

    const section = await builder.suppliersSection(context);

    expect(suppliers.findNames).toHaveBeenCalledWith('user-1', ['s-1', 's-2']);
    expect(section).toEqual({
      type: 'SUPPLIERS',
      empty: false,
      items: [
        {
          supplierId: 's-2',
          supplierName: 'Distribuidora Vet Sul',
          invoiceCount: 2,
          total: '980.00',
        },
        {
          supplierId: 's-1',
          supplierName: 'Vet Norte',
          invoiceCount: 1,
          total: '300.00',
        },
        {
          supplierId: null,
          supplierName: NO_SUPPLIER_LABEL,
          invoiceCount: 1,
          total: '170.00',
        },
      ],
      invoiceCount: 4,
      total: '1450.00',
    });
  });
});
