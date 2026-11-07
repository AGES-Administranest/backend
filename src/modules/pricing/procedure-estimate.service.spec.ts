import { Prisma } from '@prisma/client';

import { ProcedureEstimateService } from './procedure-estimate.service';
import { DomainError } from '../../shared/errors/domain-error';

const decimal = (value: string) => new Prisma.Decimal(value);

const rate = {
  month: 11,
  year: 2026,
  hourlyRate: '60.29',
  minimumHourlyRate: '54.81',
};

describe('ProcedureEstimateService', () => {
  let hourlyRate: { calculate: jest.Mock };
  let trips: { estimateCostPerDay: jest.Mock };
  let clients: { findOne: jest.Mock };
  let items: { findUnitCosts: jest.Mock };
  let service: ProcedureEstimateService;

  beforeEach(() => {
    hourlyRate = { calculate: jest.fn().mockResolvedValue(rate) };
    trips = {
      estimateCostPerDay: jest.fn().mockResolvedValue({
        available: true,
        costPerDay: decimal('60'),
        days: 4,
      }),
    };
    clients = { findOne: jest.fn().mockResolvedValue({ id: 'client-1' }) };
    items = {
      findUnitCosts: jest.fn().mockResolvedValue(
        new Map([
          ['item-1', decimal('12.5')],
          ['item-2', null],
        ]),
      ),
    };
    service = new ProcedureEstimateService(
      hourlyRate as never,
      trips as never,
      clients as never,
      items as never,
    );
  });

  it('prices the hours, the trip at the client and the supplies', async () => {
    const result = await service.estimate('user-1', {
      durationMinutes: 120,
      clientId: 'client-1',
      supplies: [
        { itemId: 'item-1', quantity: 2 },
        { itemId: 'item-2', quantity: 1 },
      ],
    });

    expect(hourlyRate.calculate).toHaveBeenCalledWith('user-1', {});
    expect(trips.estimateCostPerDay).toHaveBeenCalledWith('user-1', 'client-1');
    expect(clients.findOne).toHaveBeenCalledWith('client-1', 'user-1');
    expect(items.findUnitCosts).toHaveBeenCalledWith('user-1', [
      'item-1',
      'item-2',
    ]);
    expect(result).toEqual({
      minimumPrice: '205.58',
      breakEvenPrice: '194.62',
      hoursCost: '120.58',
      tripCost: '60.00',
      suppliesCost: '25.00',
      hourlyRateUsed: '60.29',
      minimumHourlyRateUsed: '54.81',
      tripEstimateAvailable: true,
      tripEstimateDays: 4,
      suppliesWithoutCost: ['item-2'],
      durationMinutes: 120,
      month: 11,
      year: 2026,
    });
  });

  it('prices only the hours without a client or supplies', async () => {
    const result = await service.estimate('user-1', { durationMinutes: 60 });

    expect(trips.estimateCostPerDay).not.toHaveBeenCalled();
    expect(clients.findOne).not.toHaveBeenCalled();
    expect(items.findUnitCosts).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      minimumPrice: '60.29',
      tripCost: '0.00',
      suppliesCost: '0.00',
      tripEstimateAvailable: false,
      tripEstimateDays: 0,
      suppliesWithoutCost: [],
    });
  });

  it('treats a null client as no client', async () => {
    await service.estimate('user-1', { durationMinutes: 60, clientId: null });

    expect(clients.findOne).not.toHaveBeenCalled();
    expect(trips.estimateCostPerDay).not.toHaveBeenCalled();
  });

  it('adds no trip for a client without trips', async () => {
    trips.estimateCostPerDay.mockResolvedValue({
      available: false,
      costPerDay: decimal('0'),
      days: 0,
    });

    const result = await service.estimate('user-1', {
      durationMinutes: 60,
      clientId: 'client-1',
    });

    expect(result).toMatchObject({
      tripCost: '0.00',
      tripEstimateAvailable: false,
      tripEstimateDays: 0,
    });
  });

  it('looks each item up once, even when listed on several lines', async () => {
    await service.estimate('user-1', {
      durationMinutes: 60,
      supplies: [
        { itemId: 'item-1', quantity: 1 },
        { itemId: 'item-1', quantity: 2 },
      ],
    });

    expect(items.findUnitCosts).toHaveBeenCalledWith('user-1', ['item-1']);
  });

  it('answers the hourly rate error before reading anything else', async () => {
    hourlyRate.calculate.mockRejectedValue(
      new DomainError(
        'NOT_FOUND',
        'PRICING_SETTINGS_NOT_FOUND',
        'Pricing settings are not configured yet',
      ),
    );

    await expect(
      service.estimate('user-1', {
        durationMinutes: 60,
        clientId: 'client-1',
        supplies: [{ itemId: 'item-1', quantity: 1 }],
      }),
    ).rejects.toMatchObject({
      kind: 'NOT_FOUND',
      code: 'PRICING_SETTINGS_NOT_FOUND',
    } satisfies Partial<DomainError>);
    expect(clients.findOne).not.toHaveBeenCalled();
    expect(items.findUnitCosts).not.toHaveBeenCalled();
    expect(trips.estimateCostPerDay).not.toHaveBeenCalled();
  });

  it('refuses a client of another account, or a deleted one, with a 422', async () => {
    // The client module answers 404; a reference in the body is a 422.
    clients.findOne.mockRejectedValue(
      new DomainError(
        'NOT_FOUND',
        'CLIENT_NOT_FOUND',
        'Client client-9 not found',
        {
          id: 'client-9',
        },
      ),
    );

    await expect(
      service.estimate('user-1', { durationMinutes: 60, clientId: 'client-9' }),
    ).rejects.toMatchObject({
      kind: 'INVALID_REFERENCE',
      code: 'CLIENT_NOT_FOUND',
      details: { clientId: 'client-9' },
    } satisfies Partial<DomainError>);
    expect(trips.estimateCostPerDay).not.toHaveBeenCalled();
  });

  it('lets any other error from the client module through', async () => {
    const failure = new Error('connection lost');
    clients.findOne.mockRejectedValue(failure);

    await expect(
      service.estimate('user-1', { durationMinutes: 60, clientId: 'client-1' }),
    ).rejects.toBe(failure);
  });

  it('refuses an item of another account, or a deleted one', async () => {
    items.findUnitCosts.mockResolvedValue(
      new Map([['item-1', decimal('12.5')]]),
    );

    await expect(
      service.estimate('user-1', {
        durationMinutes: 60,
        supplies: [
          { itemId: 'item-1', quantity: 1 },
          { itemId: 'item-9', quantity: 1 },
        ],
      }),
    ).rejects.toMatchObject({
      kind: 'INVALID_REFERENCE',
      code: 'ITEM_NOT_FOUND',
      details: { itemId: 'item-9' },
    } satisfies Partial<DomainError>);
  });
});
