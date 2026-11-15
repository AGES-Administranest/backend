import { Injectable } from '@nestjs/common';

import { QueryReportsAvailabilityDto } from './dto/query-reports-availability.dto';
import { ReportsAvailabilityEntity } from './entities/reports-availability.entity';
import { periodFromIsoDates } from '../../shared/dates/period';
import { AppointmentsService } from '../appointments';
import { EquipmentService } from '../equipment';
import { FinancialEntryService } from '../financial';
import { ServiceInvoiceCountService } from '../service-invoices';
import { StockEntryService } from '../stock-entry';
import { StockMovementsService } from '../stock-movements';
import { TripsService } from '../trips';

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
    const period = periodFromIsoDates(query.from, query.to);

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
}
