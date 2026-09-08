import { ERROR_CODES } from './error-codes';

describe('catálogo de códigos de erro', () => {
  it('não tem código repetido', () => {
    const repetidos = ERROR_CODES.filter(
      (codigo, i) => ERROR_CODES.indexOf(codigo) !== i,
    );

    expect(repetidos).toEqual([]);
  });

  it('segue a convenção ENTIDADE_O_QUE_ACONTECEU', () => {
    const foraDoPadrao = ERROR_CODES.filter(
      codigo => !/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(codigo),
    );

    expect(foraDoPadrao).toEqual([]);
  });
});
