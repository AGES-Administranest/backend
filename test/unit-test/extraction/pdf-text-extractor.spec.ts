import { buildPdf, PdfText } from './testing/pdf-builder';
import { MAX_PAGES } from '../../../src/modules/extraction/pdf/pdf-text-reader';
import { PdfTextExtractor } from '../../../src/modules/extraction/pdf-text-extractor';

const USER_ID = 'user-1';

const extract = (buffer: Uint8Array, mimeType = 'application/pdf') =>
  new PdfTextExtractor().extract({ buffer, mimeType, userId: USER_ID });

const HEADER: PdfText[] = [
  [40, 40, 'VET DISTRIBUIDORA DE INSUMOS LTDA'],
  [40, 54, 'CNPJ: 11.222.333/0001-81'],
  [40, 68, 'Pedido Nº 4521'],
  [300, 68, 'Data de emissão: 12/08/2026'],
  [40, 90, 'CLIENTE'],
  [40, 104, 'Clínica Vida Animal'],
  [40, 118, 'CNPJ: 12.345.678/0001-95'],
];

const TABLE: PdfText[] = [
  [40, 150, 'Descrição'],
  [300, 150, 'Qtd'],
  [380, 150, 'Vl. Unit.'],
  [480, 150, 'Vl. Total'],
  [40, 165, 'PROPOFOL 10MG/ML F/A 20ML'],
  [300, 165, '5'],
  [380, 165, '18,90'],
  [480, 165, '94,50'],
  [40, 180, 'CLORIDRATO DE CETAMINA 10ML'],
  [300, 180, '12'],
  [380, 180, '8,40'],
  [480, 180, '118,00'],
  [40, 195, 'SERINGA DESCARTÁVEL 10ML'],
  [300, 195, '5'],
  [380, 195, '48,00'],
  [480, 195, '240,00'],
  [40, 206, 'C/ AGULHA 25X7'],
  [380, 240, 'Total do pedido:'],
  [480, 240, 'R$ 452,50'],
];

describe('PdfTextExtractor', () => {
  it('reads a purchase order into header fields and item lines', async () => {
    const result = await extract(await buildPdf([[...HEADER, ...TABLE]]));

    expect(result).toEqual({
      status: 'success',
      supplier: {
        cnpj: '11222333000181',
        name: 'VET DISTRIBUIDORA DE INSUMOS LTDA',
      },
      invoiceNumber: '4521',
      orderDate: '2026-08-12',
      totalAmount: 452.5,
      items: [
        {
          extractedDescription: 'PROPOFOL 10MG/ML F/A 20ML',
          quantity: 5,
          unitValue: 18.9,
          totalValue: 94.5,
          arithmeticCheck: true,
        },
        {
          extractedDescription: 'CLORIDRATO DE CETAMINA 10ML',
          quantity: 12,
          unitValue: 8.4,
          totalValue: 118,
          arithmeticCheck: false,
        },
        {
          extractedDescription: 'SERINGA DESCARTÁVEL 10ML C/ AGULHA 25X7',
          quantity: 5,
          unitValue: 48,
          totalValue: 240,
          arithmeticCheck: true,
        },
      ],
    });
  });

  it('says the reading was partial when the document is past the page cap', async () => {
    // Header and table on the first page, one item per page after it, and the
    // grand total on a last page the reader never gets to.
    const pages = [[...HEADER, ...TABLE.slice(0, 8)]];
    for (let n = 2; n <= MAX_PAGES + 2; n++) {
      pages.push([
        [40, 60, `ITEM DA PAGINA ${n}`],
        [300, 60, '1'],
        [380, 60, '10,00'],
        [480, 60, '10,00'],
      ]);
    }
    pages.at(-1)?.push([380, 100, 'Total do pedido:'], [480, 100, 'R$ 604,50']);

    const result = await extract(await buildPdf(pages));

    expect(result.status).toBe('success');
    expect(result.partial).toEqual({
      pagesRead: MAX_PAGES,
      totalPages: MAX_PAGES + 2,
    });
    expect(result.items).toHaveLength(MAX_PAGES);
    expect(result.totalAmount).toBeUndefined();
  });

  it('reports no partial reading for a document within the cap', async () => {
    const result = await extract(await buildPdf([[...HEADER, ...TABLE]]));

    expect(result).not.toHaveProperty('partial');
  });

  it('keeps the header it read when there is no item table', async () => {
    const result = await extract(await buildPdf([HEADER]));

    expect(result).toMatchObject({
      status: 'failed',
      failureReason: 'no_table_found',
      supplier: { cnpj: '11222333000181' },
      invoiceNumber: '4521',
      items: [],
    });
  });

  it('answers no_text_layer for a PDF with no selectable text', async () => {
    const result = await extract(await buildPdf([[]]));

    expect(result).toEqual({
      status: 'failed',
      failureReason: 'no_text_layer',
      items: [],
    });
  });

  it('answers no_text_layer when only a page number made it into the text', async () => {
    const result = await extract(await buildPdf([[[500, 820, '1/1']]]));

    expect(result.failureReason).toBe('no_text_layer');
  });

  it('answers unreadable for bytes that only look like a PDF', async () => {
    const fake = new TextEncoder().encode('%PDF-1.7\nthis is not a pdf');

    await expect(extract(fake)).resolves.toEqual({
      status: 'failed',
      failureReason: 'unreadable',
      items: [],
    });
  });

  it('answers unsupported_format for a photo', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    await expect(extract(jpeg, 'image/jpeg')).resolves.toMatchObject({
      status: 'failed',
      failureReason: 'unsupported_format',
    });
  });

  it('checks the bytes, not only the declared type', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    await expect(extract(jpeg, 'application/pdf')).resolves.toMatchObject({
      failureReason: 'unsupported_format',
    });
  });
});
