import { PDFDocument } from 'pdf-lib';

import type { GeneralReportEntity } from '../../../../src/modules/reports/entities/general-report.entity';
import { generalReportDocument } from '../../../../src/modules/reports/pdf/general-report-document';
import { PdfRenderer } from '../../../../src/modules/reports/pdf/pdf-renderer';

const appointments = (
  count: number,
): GeneralReportEntity['sections'][number] => ({
  type: 'APPOINTMENTS',
  empty: false,
  count,
  billedTotal: '0.00',
  items: Array.from({ length: count }, (_, index) => ({
    id: `a-${index}`,
    startsAt: new Date('2026-10-20T14:00:00Z'),
    patientName: `Paciente ${index + 1}`,
    asa: 'II',
    weightKg: '12.5',
    location: 'Clínica Pampa',
    procedureName: 'Castração',
    amount: '450.00',
    clientName: 'Clínica Pampa',
  })),
});

const render = async (sections: GeneralReportEntity['sections']) => {
  const pdf = await new PdfRenderer().render(
    generalReportDocument(
      {
        period: { from: '2026-10-01', to: '2026-10-31' },
        sections,
        generatedAt: new Date('2026-11-11T23:20:00Z'),
      },
      { name: 'Ana Souza', crmv: 'RS 12345' },
    ),
  );
  return { pdf, document: await PDFDocument.load(pdf) };
};

describe('PdfRenderer', () => {
  it('renders a PDF that opens, with the title in its metadata', async () => {
    const { pdf, document } = await render([appointments(3)]);

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(document.getPageCount()).toBe(1);
    expect(document.getTitle()).toBe(
      'Relatório Geral — 01/10/2026 a 31/10/2026',
    );
  });

  it('paginates a long table over several pages', async () => {
    const { document } = await render([appointments(200)]);

    expect(document.getPageCount()).toBeGreaterThan(3);
  });

  it('refuses to read a local file a definition points at', async () => {
    const renderer = new PdfRenderer();

    await expect(
      renderer.render({ content: [{ image: '/etc/hostname' }] }),
    ).rejects.toThrow();
  });
});
