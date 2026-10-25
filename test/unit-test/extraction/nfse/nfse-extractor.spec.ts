import { NfseExtractor } from '../../../../src/modules/extraction/nfse/nfse-extractor';
import { NATIONAL_DANFSE } from '../testing/nfse-layouts';
import { buildPdf } from '../testing/pdf-builder';

const extract = (buffer: Uint8Array, mimeType = 'application/pdf') =>
  new NfseExtractor().extract({
    buffer,
    mimeType,
    providerTaxId: '12345678909',
  });

describe('NfseExtractor', () => {
  it('reads a DANFSe into the fields of the review', async () => {
    const result = await extract(await buildPdf([NATIONAL_DANFSE]));

    expect(result).toEqual({
      status: 'success',
      issueDate: '2026-10-13',
      grossAmount: 1500,
      number: '1287',
      taker: {
        name: 'CLINICA VETERINARIA EXEMPLO LTDA',
        taxId: '12345678000195',
      },
    });
  });

  it('fails a PDF where no field is found', async () => {
    const result = await extract(
      await buildPdf([[[40, 40, 'Relatório de atendimentos do mês']]]),
    );

    expect(result).toEqual({
      status: 'failed',
      failureReason: 'no_fields_found',
    });
  });

  it('fails a PDF without a text layer', async () => {
    const result = await extract(await buildPdf([[]]));

    expect(result).toEqual({
      status: 'failed',
      failureReason: 'no_text_layer',
    });
  });

  it('fails a file named as a PDF that is not one', async () => {
    const result = await extract(new TextEncoder().encode('Nota de serviço'));

    expect(result).toEqual({
      status: 'failed',
      failureReason: 'unsupported_format',
    });
  });
});
