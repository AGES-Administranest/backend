import { QueryGeneralReportDto } from './query-general-report.dto';

/**
 * What a report is generated from: the period and the sections, exactly as
 * `GET /reports/general` reads them. `sections` may also be a JSON array.
 */
export class GenerateReportDto extends QueryGeneralReportDto {}
