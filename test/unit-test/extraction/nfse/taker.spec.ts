import { extractTaker } from '../../../../src/modules/extraction/nfse/taker';
import { layout } from '../testing/layout';

const PROVIDER_CNPJ = '11.222.333/0001-81';

describe('extractTaker', () => {
  it('reads the name and the CNPJ from the taker block', () => {
    const lines = layout([
      [225, [40, 'TOMADOR DO SERVIÇO']],
      [240, [40, 'CNPJ / CPF / NIF']],
      [252, [40, '12.345.678/0001-95']],
      [267, [40, 'Nome / Nome Empresarial']],
      [279, [40, 'CLINICA VETERINARIA EXEMPLO LTDA']],
    ]);

    expect(extractTaker(lines)).toEqual({
      name: 'CLINICA VETERINARIA EXEMPLO LTDA',
      taxId: '12345678000195',
    });
  });

  it('reads a taker with a CPF', () => {
    const lines = layout([
      [225, [40, 'TOMADOR DO SERVIÇO']],
      [240, [40, 'CNPJ / CPF / NIF']],
      [252, [40, '987.654.321-00']],
      [267, [40, 'Nome / Nome Empresarial']],
      [279, [40, 'Pessoa Tomadora Exemplo']],
    ]);

    expect(extractTaker(lines)).toEqual({
      name: 'Pessoa Tomadora Exemplo',
      taxId: '98765432100',
    });
  });

  it('does not read a phone with valid CPF digits as the CPF', () => {
    const lines = layout([
      [225, [40, 'TOMADOR DO SERVIÇO']],
      [240, [40, 'CNPJ / CPF / NIF'], [400, 'Telefone']],
      [252, [40, '-'], [400, '51999988892']],
    ]);

    expect(extractTaker(lines)).toBeUndefined();
  });

  it('does not read the next box as the name when the name box is empty', () => {
    const lines = layout([
      [225, [40, 'TOMADOR DO SERVIÇO']],
      [267, [40, 'Nome / Nome Empresarial'], [400, 'E-mail']],
      [279, [400, 'financeiro@exemplo.com']],
    ]);

    expect(extractTaker(lines)).toBeUndefined();
  });

  it('skips the provider tax id inside the taker block', () => {
    const lines = layout([
      [225, [40, 'TOMADOR DO SERVIÇO']],
      [240, [40, `CNPJ: ${PROVIDER_CNPJ}`]],
      [252, [40, 'CNPJ: 12.345.678/0001-95']],
    ]);

    expect(extractTaker(lines, PROVIDER_CNPJ)).toEqual({
      taxId: '12345678000195',
    });
  });

  describe('without a taker block', () => {
    it('takes the tax id that is not the provider', () => {
      const lines = layout([
        [40, [40, `CNPJ: ${PROVIDER_CNPJ}`]],
        [60, [40, 'CNPJ: 12.345.678/0001-95']],
      ]);

      expect(extractTaker(lines, PROVIDER_CNPJ)).toEqual({
        taxId: '12345678000195',
      });
    });

    it('never answers the provider block as the taker', () => {
      const lines = layout([
        [40, [40, 'PRESTADOR DE SERVIÇOS']],
        [52, [40, `CNPJ: ${PROVIDER_CNPJ}`]],
      ]);

      expect(extractTaker(lines)).toBeUndefined();
    });
  });
});
