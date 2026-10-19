import { PDFDocument, StandardFonts } from 'pdf-lib';

const A4 = { width: 595, height: 842 };

/** `[x, y from the top, text]`. */
export type PdfText = [x: number, y: number, text: string];

export async function buildPdf(pages: PdfText[][]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (const texts of pages) {
    const page = document.addPage([A4.width, A4.height]);
    for (const [x, y, text] of texts) {
      page.drawText(text, { x, y: A4.height - y, size: 10, font });
    }
  }

  return document.save();
}
