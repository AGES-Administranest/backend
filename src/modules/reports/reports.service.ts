import { Injectable } from '@nestjs/common';

import { QueryReportsAvailabilityDto } from './dto/query-reports-availability.dto';
import { ReportsAvailabilityEntity } from './entities/reports-availability.entity';
import { fromIsoDate } from '../../shared/dates/iso-date';
import { Period } from '../../shared/dates/period';
import { DomainError } from '../../shared/errors/domain-error';
import { AppointmentsService } from '../appointments';
import { EquipmentService } from '../equipment';
import { FinancialEntryService } from '../financial';
import { ServiceInvoiceCountService } from '../service-invoices';
import { StockEntryService } from '../stock-entry';
import { StockMovementsService } from '../stock-movements';
import { TripsService } from '../trips';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Base of the reports area (US29, US30 and US32). It owns no table: each count
 * comes from the module that owns the records, already scoped to the user and
 * without the deleted ones.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly financialEntries: FinancialEntryService,
    private readonly serviceInvoices: ServiceInvoiceCountService,
    private readonly purchaseInvoices: StockEntryService,
    private readonly stockMovements: StockMovementsService,
    private readonly trips: TripsService,
    private readonly equipment: EquipmentService,
  ) {}

  /** How many records the period has in each section, before anything is generated. */
  async getAvailability(
    userId: string,
    query: QueryReportsAvailabilityDto,
  ): Promise<ReportsAvailabilityEntity> {
    const period = this.periodOf(query);

    const [
      appointments,
      financialEntries,
      serviceInvoices,
      purchaseInvoices,
      stockMovements,
      trips,
      equipments,
    ] = await Promise.all([
      this.appointments.countInPeriod(userId, period),
      this.financialEntries.countInPeriod(userId, period),
      this.serviceInvoices.countConfirmedInPeriod(userId, period),
      this.purchaseInvoices.countConfirmedInPeriod(userId, period),
      this.stockMovements.countInPeriod(userId, period),
      this.trips.countInPeriod(userId, period),
      this.equipment.countAcquiredInPeriod(userId, period),
    ]);

    return {
      appointments,
      financialEntries,
      serviceInvoices,
      purchaseInvoices,
      stockMovements,
      trips,
      equipments,
      total:
        appointments +
        financialEntries +
        serviceInvoices +
        purchaseInvoices +
        stockMovements +
        trips +
        equipments,
    };
  }

  /** Both days are included, so the period ends at the start of the day after `to`. */
  private periodOf(query: QueryReportsAvailabilityDto): Period {
    const from = fromIsoDate(query.from);
    const to = fromIsoDate(query.to);

    if (from.getTime() > to.getTime()) {
      throw new DomainError(
        'INVALID_INPUT',
        'REPORT_PERIOD_INVALID',
        '`from` must not be after `to`',
        { from: query.from, to: query.to },
      );
    }

    return { from, to: new Date(to.getTime() + DAY_IN_MS) };
  }
}
