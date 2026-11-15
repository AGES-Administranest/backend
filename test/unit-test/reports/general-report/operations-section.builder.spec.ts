import { Prisma } from '@prisma/client';

import {
  NO_CLIENT_LABEL,
  OperationsSectionBuilder,
} from '../../../../src/modules/reports/general-report/operations-section.builder';
import { ReportContext } from '../../../../src/modules/reports/general-report/report-context';

const d = (value: string | number) => new Prisma.Decimal(value);

describe('OperationsSectionBuilder', () => {
  const context = new ReportContext('user-1', '2026-10-01', '2026-10-31', {
    monthlyDepreciation: jest.fn(),
  } as never);

  const build = () => {
    const appointments = {
      findCompletedInPeriod: jest.fn().mockResolvedValue([]),
      sumCompletedGroupedByClient: jest.fn().mockResolvedValue([]),
    };
    const trips = { totalsGroupedByClient: jest.fn().mockResolvedValue([]) };
    const clients = { findNames: jest.fn().mockResolvedValue(new Map()) };
    const builder = new OperationsSectionBuilder(
      appointments as never,
      trips as never,
      clients as never,
    );
    return { builder, appointments, trips, clients };
  };

  describe('appointmentsSection', () => {
    const row = {
      id: 'a-1',
      startsAt: new Date('2026-10-02T13:00:00Z'),
      patientName: 'Thor',
      asa: 'II',
      weightKg: d('12.5'),
      location: null,
      procedureName: 'Castração',
      amount: d('450'),
      clientId: 'c-1',
      client: {
        name: 'Clínica Pampa',
        addressLine: 'Rua das Flores, 100',
        city: 'Porto Alegre',
        state: 'RS',
      },
    };

    it('lists the completed appointments of the period with their totals', async () => {
      const { builder, appointments } = build();
      appointments.findCompletedInPeriod.mockResolvedValue([
        row,
        {
          ...row,
          id: 'a-2',
          location: 'Fazenda Boa Vista',
          amount: null,
          weightKg: null,
          client: null,
        },
      ]);

      const section = await builder.appointmentsSection(context);

      expect(appointments.findCompletedInPeriod).toHaveBeenCalledWith(
        'user-1',
        context.appointmentPeriod,
      );
      expect(section).toMatchObject({
        type: 'APPOINTMENTS',
        empty: false,
        count: 2,
        billedTotal: '450.00',
      });
      expect(section.items[0]).toEqual({
        id: 'a-1',
        startsAt: row.startsAt,
        patientName: 'Thor',
        asa: 'II',
        weightKg: '12.5',
        location: 'Rua das Flores, 100, Porto Alegre, RS',
        procedureName: 'Castração',
        amount: '450.00',
        clientName: 'Clínica Pampa',
      });
      expect(section.items[1]).toMatchObject({
        location: 'Fazenda Boa Vista',
        amount: null,
        weightKg: null,
        clientName: null,
      });
    });

    it('is empty without appointments', async () => {
      const { builder } = build();
      expect(await builder.appointmentsSection(context)).toMatchObject({
        empty: true,
        items: [],
        count: 0,
        billedTotal: '0.00',
      });
    });
  });

  describe('clientsSection', () => {
    it('merges appointments and trips by client, with a group for no client', async () => {
      const { builder, appointments, trips, clients } = build();
      appointments.sumCompletedGroupedByClient.mockResolvedValue([
        { clientId: 'c-1', count: 3, amount: d('1200') },
        { clientId: null, count: 1, amount: d('300') },
        { clientId: 'c-2', count: 2, amount: d('2000') },
      ]);
      trips.totalsGroupedByClient.mockResolvedValue([
        { clientId: 'c-1', count: 2, cost: d('40.5') },
        { clientId: 'c-3', count: 1, cost: d('15') },
      ]);
      clients.findNames.mockResolvedValue(
        new Map([
          ['c-1', 'Clínica Pampa'],
          ['c-2', 'Hospital Sul'],
          ['c-3', 'Pet Center'],
        ]),
      );

      const section = await builder.clientsSection(context);

      expect(trips.totalsGroupedByClient).toHaveBeenCalledWith(
        'user-1',
        context.tripPeriod,
      );
      expect(clients.findNames).toHaveBeenCalledWith('user-1', [
        'c-1',
        'c-2',
        'c-3',
      ]);
      expect(section.items).toEqual([
        {
          clientId: 'c-2',
          clientName: 'Hospital Sul',
          appointmentsCount: 2,
          billedTotal: '2000.00',
          tripCount: 0,
          tripCost: '0.00',
        },
        {
          clientId: 'c-1',
          clientName: 'Clínica Pampa',
          appointmentsCount: 3,
          billedTotal: '1200.00',
          tripCount: 2,
          tripCost: '40.50',
        },
        {
          clientId: null,
          clientName: NO_CLIENT_LABEL,
          appointmentsCount: 1,
          billedTotal: '300.00',
          tripCount: 0,
          tripCost: '0.00',
        },
        {
          clientId: 'c-3',
          clientName: 'Pet Center',
          appointmentsCount: 0,
          billedTotal: '0.00',
          tripCount: 1,
          tripCost: '15.00',
        },
      ]);
      expect(section).toMatchObject({
        empty: false,
        appointmentsCount: 6,
        billedTotal: '3500.00',
        tripCost: '55.50',
      });
    });

    it('is empty without appointments or trips', async () => {
      const { builder } = build();
      expect(await builder.clientsSection(context)).toMatchObject({
        empty: true,
        items: [],
      });
    });
  });
});
