import { Injectable } from '@nestjs/common';

import { ServiceInvoicesRepository } from './service-invoices.repository';
import { Period } from '../../shared/dates/period';

/**
 * The part of the module other modules may ask for: how many confirmed notes a
 * user has in a period. The repository itself stays private to the module.
 */
@Injectable()
export class ServiceInvoiceCountService {
  constructor(private readonly repository: ServiceInvoicesRepository) {}

  countConfirmedInPeriod(userId: string, period: Period): Promise<number> {
    return this.repository.countConfirmedInPeriod(userId, period);
  }
}
