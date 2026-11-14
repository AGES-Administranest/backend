import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { QueryGeneralReportDto } from '../../../../src/modules/reports/dto/query-general-report.dto';

const parse = async (query: Record<string, unknown>) => {
  const dto = plainToInstance(QueryGeneralReportDto, query);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, failed: errors.map(error => error.property).sort() };
};

const period = { from: '2026-10-15', to: '2026-11-14' };

describe('QueryGeneralReportDto', () => {
  it('reads a comma-separated list', async () => {
    const { dto, failed } = await parse({
      ...period,
      sections: 'FINANCIAL, TRIPS',
    });
    expect(failed).toEqual([]);
    expect(dto.sections).toEqual(['FINANCIAL', 'TRIPS']);
  });

  it('reads the parameter repeated', async () => {
    const { dto, failed } = await parse({
      ...period,
      sections: ['FINANCIAL', 'STOCK,SUPPLIERS'],
    });
    expect(failed).toEqual([]);
    expect(dto.sections).toEqual(['FINANCIAL', 'STOCK', 'SUPPLIERS']);
  });

  it('leaves the sections out when they are not sent', async () => {
    const { dto, failed } = await parse(period);
    expect(failed).toEqual([]);
    expect(dto.sections).toBeUndefined();
  });

  it('lets an empty list through, for the service to refuse with its own code', async () => {
    const { dto, failed } = await parse({ ...period, sections: '' });
    expect(failed).toEqual([]);
    expect(dto.sections).toEqual([]);
  });

  it('refuses an unknown section', async () => {
    const { failed } = await parse({ ...period, sections: 'FINANCIAL,TAXES' });
    expect(failed).toEqual(['sections']);
  });

  it('checks the dates as the availability check does', async () => {
    const { failed } = await parse({ from: '2026-10-15', to: '14/11/2026' });
    expect(failed).toEqual(['to']);
  });
});
