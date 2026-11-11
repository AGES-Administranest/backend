import { Injectable } from '@nestjs/common';
import { Client } from '@prisma/client';

import { money, sum, ZERO } from './format';
import { ReportContext } from './report-context';
import { AppointmentsService } from '../../appointments';
import { ClientService } from '../../client';
import { TripsService } from '../../trips';
import {
  AppointmentsReportSection,
  ClientsReportSection,
  ReportClientItem,
} from '../entities/general-report.entity';

/** How the report names the records that have no client. */
export const NO_CLIENT_LABEL = 'Sem tomador';

type ClientAddress = Pick<Client, 'addressLine' | 'city' | 'state'>;

function addressOf(client: ClientAddress | null): string | null {
  if (!client) return null;
  const parts = [client.addressLine, client.city, client.state]
    .map(part => part?.trim())
    .filter(part => Boolean(part));
  return parts.length ? parts.join(', ') : null;
}

/** Appointments and Clients sections (US29). */
@Injectable()
export class OperationsSectionBuilder {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly trips: TripsService,
    private readonly clients: ClientService,
  ) {}

  async appointmentsSection(
    context: ReportContext,
  ): Promise<AppointmentsReportSection> {
    const rows = await this.appointments.findCompletedInPeriod(
      context.userId,
      context.appointmentPeriod,
    );

    return {
      type: 'APPOINTMENTS',
      empty: rows.length === 0,
      items: rows.map(row => ({
        id: row.id,
        startsAt: row.startsAt,
        patientName: row.patientName,
        asa: row.asa,
        weightKg: row.weightKg?.toString() ?? null,
        location: row.location?.trim() || addressOf(row.client),
        procedureName: row.procedureName,
        amount: row.amount ? money(row.amount) : null,
        clientName: row.client?.name ?? null,
      })),
      count: rows.length,
      billedTotal: money(sum(rows.map(row => row.amount ?? ZERO))),
    };
  }

  /**
   * By client, with the same filters as the client summary (US17): completed
   * appointments in the period, and the trips linked to the client.
   */
  async clientsSection(context: ReportContext): Promise<ClientsReportSection> {
    const [appointments, trips] = await Promise.all([
      this.appointments.sumCompletedGroupedByClient(
        context.userId,
        context.appointmentPeriod,
      ),
      this.trips.totalsGroupedByClient(context.userId, context.tripPeriod),
    ]);

    const clientIds = [
      ...new Set(
        [...appointments, ...trips]
          .map(row => row.clientId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const names = await this.clients.findNames(context.userId, clientIds);

    const byClient = new Map<string | null, ReportClientItem>();
    const itemFor = (clientId: string | null): ReportClientItem => {
      const existing = byClient.get(clientId);
      if (existing) return existing;
      const item: ReportClientItem = {
        clientId,
        clientName:
          clientId === null
            ? NO_CLIENT_LABEL
            : (names.get(clientId) ?? NO_CLIENT_LABEL),
        appointmentsCount: 0,
        billedTotal: money(ZERO),
        tripCount: 0,
        tripCost: money(ZERO),
      };
      byClient.set(clientId, item);
      return item;
    };

    for (const row of appointments) {
      const item = itemFor(row.clientId);
      item.appointmentsCount = row.count;
      item.billedTotal = money(row.amount);
    }
    for (const row of trips) {
      const item = itemFor(row.clientId);
      item.tripCount = row.count;
      item.tripCost = money(row.cost);
    }

    const items = [...byClient.values()].sort(
      (a, b) =>
        Number(b.billedTotal) - Number(a.billedTotal) ||
        a.clientName.localeCompare(b.clientName, 'pt-BR'),
    );

    return {
      type: 'CLIENTS',
      empty: items.length === 0,
      items,
      appointmentsCount: appointments.reduce((n, row) => n + row.count, 0),
      billedTotal: money(sum(appointments.map(row => row.amount))),
      tripCost: money(sum(trips.map(row => row.cost))),
    };
  }
}
