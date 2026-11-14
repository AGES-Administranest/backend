import { nameEntries } from './tax-package-file-names';
import { TaxPackageDocument } from '../../../shared/tax-package/tax-package.types';

const document = (
  overrides: Partial<TaxPackageDocument> = {},
): TaxPackageDocument => ({
  collection: 'service-invoices',
  id: '1',
  issueDate: new Date('2026-03-15T00:00:00.000Z'),
  counterpartName: 'Clínica Vet Nova',
  amount: 350,
  fileName: 'nfse.pdf',
  mimeType: 'application/pdf',
  ...overrides,
});

const namesOf = (documents: TaxPackageDocument[]) =>
  nameEntries(documents).map(entry => entry.name);

describe('nameEntries', () => {
  it('names a document by date, counterpart and amount, without accents', () => {
    expect(namesOf([document()])).toEqual([
      'NFS-e/2026-03-15_ClinicaVetNova_350,00.pdf',
    ]);
  });

  it('keeps the cents and puts each kind of document in its own folder', () => {
    expect(
      namesOf([
        document({
          collection: 'purchase-invoices',
          counterpartName: 'Distribuidora São João Ltda.',
          amount: 1234.5,
        }),
      ]),
    ).toEqual(['Compras/2026-03-15_DistribuidoraSaoJoaoLtda_1234,50.pdf']);
  });

  it('numbers a repeated name instead of overwriting it', () => {
    expect(namesOf([document(), document(), document()])).toEqual([
      'NFS-e/2026-03-15_ClinicaVetNova_350,00.pdf',
      'NFS-e/2026-03-15_ClinicaVetNova_350,00_2.pdf',
      'NFS-e/2026-03-15_ClinicaVetNova_350,00_3.pdf',
    ]);
  });

  it('judges repetition ignoring case, as Windows and macOS do', () => {
    const names = namesOf([
      document({ counterpartName: 'abc' }),
      document({ counterpartName: 'ABC' }),
    ]);
    expect(new Set(names.map(name => name.toLowerCase())).size).toBe(2);
  });

  it('does not collide across kinds: each has its folder', () => {
    const names = namesOf([
      document(),
      document({ collection: 'purchase-invoices' }),
    ]);
    expect(new Set(names).size).toBe(2);
  });

  it('only ever writes ASCII without path or control characters', () => {
    const [name] = namesOf([
      document({ counterpartName: '../../etc/passwd "ñ" <b>\\ \n' }),
    ]);
    expect(name).toMatch(/^NFS-e\/[A-Za-z0-9,_.-]+$/);
    expect(name).not.toContain('..');
  });

  it('falls back when the counterpart or the amount is unknown', () => {
    expect(
      namesOf([document({ counterpartName: null, amount: null })]),
    ).toEqual(['NFS-e/2026-03-15_SemNome_SemValor.pdf']);
    expect(namesOf([document({ counterpartName: '!!!' })])[0]).toContain(
      '_SemNome_',
    );
  });

  it('cuts a very long counterpart name', () => {
    const [name] = namesOf([document({ counterpartName: 'A'.repeat(300) })]);
    expect(name?.length).toBeLessThan(80);
  });

  it('takes the extension from the MIME type, then from the file name', () => {
    expect(namesOf([document({ mimeType: 'image/jpeg' })])[0]).toMatch(
      /\.jpg$/,
    );
    expect(
      namesOf([document({ mimeType: null, fileName: 'scan.JPEG' })])[0],
    ).toMatch(/\.jpeg$/);
    expect(namesOf([document({ mimeType: null, fileName: null })])[0]).toMatch(
      /\.pdf$/,
    );
  });

  it('names the same input the same way every time', () => {
    const documents = [document(), document({ id: '2' }), document()];
    expect(namesOf(documents)).toEqual(namesOf(documents));
  });
});
