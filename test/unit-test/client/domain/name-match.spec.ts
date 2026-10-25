import {
  normalizeClientName,
  rankByName,
} from '../../../../src/modules/client/domain/name-match';

describe('normalizeClientName', () => {
  it.each([
    ['CLINICA VETERINARIA EXEMPLO LTDA', 'exemplo'],
    ['Clínica Veterinária São Francisco de Assis', 'sao francisco assis'],
    ['Pet Center Exemplo S/A', 'center exemplo'],
    ['Hospital Exemplo S.A.', 'exemplo'],
    ['Hospital Veterinário', 'hospital veterinario'],
    ['  ', ''],
  ])('%p → %p', (name, normalized) => {
    expect(normalizeClientName(name)).toBe(normalized);
  });
});

describe('rankByName', () => {
  const clients = [
    { id: 'bichos', name: 'Clínica Veterinária Bichos' },
    { id: 'north', name: 'Clínica Exemplo Norte' },
    { id: 'same', name: 'Clinica Exemplo' },
    { id: 'santa', name: 'Clínica Santa Maria' },
  ];

  it('ranks the closest first, ignoring the words every clinic shares', () => {
    expect(
      rankByName('CLINICA VETERINARIA EXEMPLO LTDA', clients).map(c => c.id),
    ).toEqual(['same', 'north']);
  });

  it('leaves out a name under the threshold', () => {
    expect(rankByName('Clínica Santa Clara', clients)).toEqual([]);
  });

  it('keeps the best ones up to the limit', () => {
    const many = ['A', 'B', 'C', 'D'].map(suffix => ({
      id: suffix,
      name: `Exemplo ${suffix}`,
    }));

    expect(rankByName('Exemplo', many)).toHaveLength(3);
  });

  it('suggests nothing for a name with nothing to compare', () => {
    expect(rankByName('LTDA', clients)).toEqual([]);
  });
});
