import {
  similarity,
  trigrams,
} from '../../../../src/modules/item-match/domain/trigram';

describe('trigrams', () => {
  it('pads each word like pg_trgm', () => {
    expect([...trigrams('propofol')].sort()).toEqual(
      ['  p', ' pr', 'pro', 'rop', 'opo', 'pof', 'ofo', 'fol', 'ol '].sort(),
    );
  });

  it('splits on anything that is not a letter or digit', () => {
    expect(trigrams('a-b')).toEqual(trigrams('a b'));
  });
});

describe('similarity', () => {
  it.each([
    // US10 §4.5: 6 shared trigrams out of 11.
    ['propofol', 'propofl', 6 / 11],
    ['propofol', 'propofol', 1],
    ['propofol', 'seringa', 0],
    ['', 'propofol', 0],
  ])('%s × %s', (a, b, expected) => {
    expect(similarity(a, b)).toBeCloseTo(expected, 6);
  });
});
