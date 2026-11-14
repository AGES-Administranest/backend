import { downloadFileNameOf } from '../../../../src/modules/service-invoices/domain/download-file-name';

describe('downloadFileNameOf', () => {
  it.each([
    ['nfse-1287.pdf', 'nfse-1287.pdf'],
    ['nfse 1287', 'nfse 1287.pdf'],
    ['Nota Fiscal.PDF', 'Nota Fiscal.pdf'],
    ['nota d’água.pdf', 'nota d’água.pdf'],
  ])('keeps %j as %j', (declared, expected) => {
    expect(downloadFileNameOf(declared)).toBe(expected);
  });

  it.each([
    ['a/b\\c.pdf', 'a_b_c.pdf'],
    ['say "hi".pdf', 'say _hi_.pdf'],
    ['tab\there\u0000.pdf', 'tabhere.pdf'],
    ['line\r\nbreak.pdf', 'linebreak.pdf'],
    ['...hidden.pdf', 'hidden.pdf'],
  ])('cleans %j into %j', (declared, expected) => {
    expect(downloadFileNameOf(declared)).toBe(expected);
  });

  it.each([null, '', '   ', '.pdf', '///'.replace(/\//g, '\u0000')])(
    'falls back to nota_fiscal.pdf for %j',
    declared => {
      expect(downloadFileNameOf(declared)).toBe('nota_fiscal.pdf');
    },
  );

  it('cuts a very long name', () => {
    const name = downloadFileNameOf(`${'a'.repeat(500)}.pdf`);

    expect(name).toHaveLength(104);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});
