import { MAX_PAGES, PdfUnreadableError, readPdfText } from './pdf-text-reader';
import { buildPdf } from '../testing/pdf-builder';

describe('readPdfText', () => {
  it('reads each run with its position, measured from the top', async () => {
    const pdf = await buildPdf([
      [
        [40, 100, 'Descrição'],
        [300, 100, 'Qtd'],
        [40, 115, 'PROPOFOL 10MG/ML'],
      ],
    ]);

    const {
      pages: [page],
      totalPages,
    } = await readPdfText(pdf);

    expect(totalPages).toBe(1);

    expect(page.page).toBe(1);
    expect(page.fragments).toEqual([
      expect.objectContaining({ text: 'Descrição', x: 40, y: 100, height: 10 }),
      expect.objectContaining({ text: 'Qtd', x: 300, y: 100 }),
      expect.objectContaining({ text: 'PROPOFOL 10MG/ML', x: 40, y: 115 }),
    ]);
    expect(page.fragments[0].width).toBeGreaterThan(0);
  });

  it('answers an empty page for a PDF with no text layer', async () => {
    const pdf = await buildPdf([[]]);

    await expect(readPdfText(pdf)).resolves.toEqual({
      pages: [{ page: 1, fragments: [] }],
      totalPages: 1,
    });
  });

  it(`stops after ${MAX_PAGES} pages and says how many there were`, async () => {
    const pdf = await buildPdf(
      Array.from({ length: MAX_PAGES + 2 }, (_, i) => [[40, 100, `p${i}`]]),
    );

    const { pages, totalPages } = await readPdfText(pdf);

    expect(pages).toHaveLength(MAX_PAGES);
    expect(totalPages).toBe(MAX_PAGES + 2);
  });

  it('leaves the caller’s bytes intact', async () => {
    const pdf = await buildPdf([[[40, 100, 'x']]]);
    const before = pdf.byteLength;

    await readPdfText(pdf);

    expect(pdf.byteLength).toBe(before);
  });

  it('rejects bytes that only look like a PDF', async () => {
    const fake = new TextEncoder().encode('%PDF-1.7\nthis is not a pdf');

    await expect(readPdfText(fake)).rejects.toBeInstanceOf(PdfUnreadableError);
  });
});
