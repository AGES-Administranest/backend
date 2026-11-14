import { Injectable } from '@nestjs/common';
import { dirname, resolve, sep } from 'node:path';
import pdfmake from 'pdfmake';
import Roboto from 'pdfmake/fonts/Roboto';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

const FONTS_DIR = dirname(
  require.resolve('pdfmake/fonts/Roboto/Roboto-Regular.ttf'),
);

/**
 * Turns a document definition into the bytes of a PDF (ADR-04: pdfmake, pure
 * JavaScript, no browser).
 *
 * pdfmake is one shared instance (`module.exports = new pdfmake()`), hence the
 * default import: a namespace import would copy it without its methods.
 *
 * It may read its own font files and nothing else: a definition never makes
 * the server open a local file or fetch a URL.
 */
@Injectable()
export class PdfRenderer {
  constructor() {
    pdfmake.setFonts(Roboto);
    pdfmake.setLocalAccessPolicy(file =>
      resolve(file).startsWith(FONTS_DIR + sep),
    );
    pdfmake.setUrlAccessPolicy(() => false);
  }

  render(definition: TDocumentDefinitions): Promise<Buffer> {
    return pdfmake.createPdf(definition).getBuffer();
  }
}
