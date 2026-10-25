import {
  categoryNameKey,
  tidyCategoryName,
} from '../../../src/modules/financial/domain/category-name';

describe('tidyCategoryName', () => {
  it.each([
    ['  Custos   fixos ', 'Custos fixos'],
    ['Comida', 'Comida'],
    ['Material\tde  escritório', 'Material de escritório'],
  ])('stores %j as %j', (name, stored) => {
    expect(tidyCategoryName(name)).toBe(stored);
  });

  it('keeps case and accents, because they are what the user typed', () => {
    expect(tidyCategoryName('Manutenção')).toBe('Manutenção');
  });
});

describe('categoryNameKey', () => {
  it.each([
    ['  Custos   fixos ', 'custos fixos'],
    ['Manutenção', 'manutencao'],
    ['MANUTENÇÃO', 'manutencao'],
    ['Café', 'cafe'],
    ['Other', 'other'],
  ])('compares %j as %j', (name, key) => {
    expect(categoryNameKey(name)).toBe(key);
  });

  it('gives the same key to names that differ only in case, accents or spaces', () => {
    expect(categoryNameKey('Comída')).toBe(categoryNameKey(' comida '));
  });

  it('keeps names with different letters apart', () => {
    expect(categoryNameKey('Com')).not.toBe(categoryNameKey('Comida'));
  });

  it('does not translate a default: "Outros" is not "Other"', () => {
    expect(categoryNameKey('Outros')).not.toBe(categoryNameKey('Other'));
  });
});
