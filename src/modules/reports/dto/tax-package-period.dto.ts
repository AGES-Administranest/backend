import { QueryReportsAvailabilityDto } from './query-reports-availability.dto';

/**
 * The period of a tax package: the query of the summary and the body of the
 * export. Same two dates as the availability check, so the three agree on what
 * a period is.
 */
export class TaxPackagePeriodDto extends QueryReportsAvailabilityDto {}
