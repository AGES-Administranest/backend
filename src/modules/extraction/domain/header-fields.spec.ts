import { extractHeader } from './header-fields';
import { layout } from '../testing/layout';

describe('extractHeader', () => {
  it('reads an order header with the usual labels', () => {
    const lines = layout([
      [40, [40, 'DISTRIBUIDORA VETERINARIA EXEMPLO LTDA']],
      [52, [40, 'CNPJ: 11.222.333/0001-81']],
      [64, [40, 'Pedido: 4521'], [200, 'Data: 12/08/2026']],
      [300, [380, 'Total do pedido:'], [480, 'R$ 2.418,90']],
    ]);

    expect(extractHeader(lines)).toEqual({
      supplier: {
        cnpj: '11222333000181',
        name: 'DISTRIBUIDORA VETERINARIA EXEMPLO LTDA',
      },
      invoiceNumber: '4521',
      orderDate: '2026-08-12',
      totalAmount: 2418.9,
    });
  });

  it('answers only what it found', () => {
    expect(extractHeader(layout([[40, [40, 'Relatório de compras']]]))).toEqual(
      {},
    );
  });

  describe('supplier', () => {
    it('picks the supplier CNPJ over the buyer one, whatever the order', () => {
      const lines = layout([
        [40, [40, 'CLIENTE'], [300, 'FORNECEDOR']],
        [52, [40, 'Clínica Vida Animal'], [300, 'Vet Distribuidora LTDA']],
        [64, [40, 'CNPJ 12.345.678/0001-95'], [300, 'CNPJ 11.222.333/0001-81']],
      ]);

      expect(extractHeader(lines).supplier).toEqual({
        cnpj: '11222333000181',
        name: 'Vet Distribuidora LTDA',
      });
    });

    it('reads a labeled name', () => {
      const lines = layout([
        [40, [40, 'Razão Social: Agrovet Insumos Ltda']],
        [52, [40, 'CNPJ: 98.765.432/0001-98']],
      ]);

      expect(extractHeader(lines).supplier).toEqual({
        cnpj: '98765432000198',
        name: 'Agrovet Insumos Ltda',
      });
    });

    it('reads the name before the CNPJ on the same line', () => {
      const lines = layout([
        [40, [40, 'Pet Supply Med EIRELI - CNPJ 12.345.678/0001-95']],
      ]);

      expect(extractHeader(lines).supplier).toEqual({
        cnpj: '12345678000195',
        name: 'Pet Supply Med EIRELI',
      });
    });

    it('ignores a CNPJ whose check digits fail', () => {
      const lines = layout([[40, [40, 'CNPJ: 11.222.333/0001-99']]]);

      expect(extractHeader(lines).supplier).toBeUndefined();
    });
  });

  describe('document number', () => {
    it.each([
      ['Pedido Nº 4521', '4521'],
      ['Nº do pedido: 000123', '000123'],
      ['NF-e Nº 000.001.234 Série 1', '000.001.234'],
      ['Pedido de compra Nº PC-88', 'PC-88'],
      ['NR. COTAÇÃO: ABHXSU VALIDADE : 04/08/2026', 'ABHXSU'],
      ['Orçamento Nº 8841', '8841'],
      ['Proposta nº ABHX12', 'ABHX12'],
      ['Nº PEDIDO CLIENTE: 998', '998'],
    ])('reads %p', (text, expected) => {
      expect(extractHeader(layout([[40, [40, text]]])).invoiceNumber).toBe(
        expected,
      );
    });

    it('does not take the order date or total for a number', () => {
      const lines = layout([
        [40, [40, 'Data do pedido: 12/08/2026']],
        [52, [40, 'Total do pedido: 94,50']],
      ]);

      expect(extractHeader(lines).invoiceNumber).toBeUndefined();
    });

    it.each(['PEDIDO APROVADO', 'Nr. pedido: aprovado', 'Nº PEDIDO: CLIENTE'])(
      'does not take a word for a code of letters in %p',
      text => {
        expect(
          extractHeader(layout([[40, [40, text]]])).invoiceNumber,
        ).toBeUndefined();
      },
    );
  });

  // Laid out like a distributor's ERP quotation, with made-up data: CNPJ
  // unmasked, the customer's CPF printed under a "CNPJ" label, a validity
  // date next to the number and the issue date in the footer.
  it('reads a quotation header from a distributor ERP layout', () => {
    const lines = layout([
      [27, [202, 'DISTRIBUIDORA EXEMPLO DE PRODUTOS HOSPITALARES SA']],
      [47, [202, 'CNPJ: 11222333000181']],
      [112, [423, 'COTAÇÃO']],
      [132, [25, 'NR. COTAÇÃO: QWERTY VALIDADE : 04/08/2026']],
      [147, [25, 'Cód./Cliente: 04999001'], [141, 'CLIENTE DE TESTE']],
      [162, [25, 'CNPJ:'], [86, '12345678909']],
      [395, [478, 'TOTAL FINAL DO PEDIDO: R$'], [728, '1.368,32']],
      [542, [25, 'Data e Local: 31/07/2026 CIDADE / RS']],
    ]);

    expect(extractHeader(lines)).toEqual({
      supplier: {
        cnpj: '11222333000181',
        name: 'DISTRIBUIDORA EXEMPLO DE PRODUTOS HOSPITALARES SA',
      },
      invoiceNumber: 'QWERTY',
      orderDate: '2026-07-31',
      totalAmount: 1368.32,
    });
  });

  describe('sections of the page', () => {
    it('does not take the customer block for the supplier, whatever its labels', () => {
      const lines = layout([
        [27, [28, 'PAMPA COMERCIO DE PRODUTOS HOSPITALARES LTDA']],
        [41, [28, 'CNPJ: 11.222.333/0001-81']],
        [80, [28, 'CLIENTE']],
        [
          92,
          [28, 'Razão Social/Nome Hospital Veterinário Quatro Patas Ltda'],
          [300, 'CNPJ/CPF 12.345.678/0001-95'],
        ],
      ]);

      expect(extractHeader(lines).supplier).toEqual({
        cnpj: '11222333000181',
        name: 'PAMPA COMERCIO DE PRODUTOS HOSPITALARES LTDA',
      });
    });

    it('reads the DANFE issuer block and skips the recipient and the carrier', () => {
      const lines = layout([
        [40, [40, 'IDENTIFICAÇÃO DO EMITENTE'], [420, 'NF-e']],
        [
          54,
          [40, 'Vetsul Comércio de Produtos Veterinários Ltda'],
          [420, 'Nº. 000.018.452'],
        ],
        [70, [40, 'INSCRIÇÃO ESTADUAL'], [300, 'CNPJ']],
        [82, [40, '096/3481276'], [300, '11.222.333/0001-81']],
        [100, [40, 'DESTINATÁRIO / REMETENTE']],
        [112, [40, 'NOME / RAZÃO SOCIAL'], [300, 'CNPJ / CPF']],
        [
          124,
          [40, 'JMP SERVICOS DE ANESTESIOLOGIA LTDA'],
          [300, '12.345.678/0001-95'],
        ],
        [150, [40, 'TRANSPORTADOR / VOLUMES TRANSPORTADOS']],
        [162, [40, 'NOME / RAZÃO SOCIAL'], [300, 'CNPJ / CPF']],
        [174, [40, 'TRANSPORTADORA EXEMPLO LTDA'], [300, '98.765.432/0001-98']],
      ]);

      expect(extractHeader(lines)).toMatchObject({
        supplier: {
          cnpj: '11222333000181',
          name: 'Vetsul Comércio de Produtos Veterinários Ltda',
        },
        invoiceNumber: '000.018.452',
      });
    });
  });

  it('keeps the final dot of the legal form', () => {
    const lines = layout([
      [28, [28, 'Mestre Exemplo Distribuidora Hospitalar S.A.']],
      [42, [28, 'CNPJ: 11.222.333/0001-81']],
    ]);

    expect(extractHeader(lines).supplier?.name).toBe(
      'Mestre Exemplo Distribuidora Hospitalar S.A.',
    );
  });

  it('completes a DANFE issuer name whose legal form wrapped to the next line', () => {
    const lines = layout([
      [40, [40, 'IDENTIFICAÇÃO DO EMITENTE']],
      [54, [20, 'Cerrado Exemplo Comércio de Produtos Médico-Hospitalares']],
      // A line of the DANFE's central box, at the same height, in between.
      [60, [330, 'Nota Fiscal Eletrônica']],
      [66, [110, 'Ltda']],
      [78, [60, 'Rua Exemplo, 100 - Centro']],
      [90, [60, 'Goiânia - GO']],
    ]);

    expect(extractHeader(lines).supplier?.name).toBe(
      'Cerrado Exemplo Comércio de Produtos Médico-Hospitalares Ltda',
    );
  });

  it('joins a company name that wraps in the letterhead', () => {
    // The document title shares the first line: it must not break the match.
    const lines = layout([
      [28, [28, 'Casa do Veterinário Comércio de Produtos'], [480, 'Pedido']],
      [42, [28, 'Agropecuários Ltda']],
      [56, [28, 'CNPJ: 11.222.333/0001-81']],
    ]);

    expect(extractHeader(lines).supplier?.name).toBe(
      'Casa do Veterinário Comércio de Produtos Agropecuários Ltda',
    );
  });

  it('prefers the number above the item table to one quoted in the notes', () => {
    const lines = layout([
      [40, [40, 'DANFE'], [420, 'Nº. 000.018.452']],
      [400, [40, 'PEDIDO 45120 - VEND.: RODRIGO']],
    ]);

    expect(extractHeader(lines, { page: 1, y: 200 }).invoiceNumber).toBe(
      '000.018.452',
    );
    // Without knowing where the table is, the order label ranks first.
    expect(extractHeader(lines).invoiceNumber).toBe('45120');
  });

  describe('order date', () => {
    it('prefers the issue date over a due date printed first', () => {
      const lines = layout([
        [40, [40, 'Vencimento: 30/08/2026']],
        [52, [40, 'Data de emissão: 12/08/2026']],
      ]);

      expect(extractHeader(lines).orderDate).toBe('2026-08-12');
    });

    it('falls back to the first date that is not a due or delivery date', () => {
      const lines = layout([
        [40, [40, 'Entrega prevista 20/08/2026']],
        [52, [40, 'Porto Alegre, 12/08/2026']],
      ]);

      expect(extractHeader(lines).orderDate).toBe('2026-08-12');
    });

    it('takes the dispatch date of a delivery slip that prints no other', () => {
      const lines = layout([
        [40, [40, 'Romaneio Nº: 20931'], [300, 'Data Saída: 06/08/2026']],
        [52, [40, 'Previsão de saída: 10/08/2026']],
      ]);

      expect(extractHeader(lines).orderDate).toBe('2026-08-06');
    });

    it('prefers the issue date over the dispatch date', () => {
      const lines = layout([
        [40, [40, 'Data da saída: 14/08/2026']],
        [52, [40, 'Data de emissão: 12/08/2026']],
      ]);

      expect(extractHeader(lines).orderDate).toBe('2026-08-12');
    });
  });

  describe('total', () => {
    it('prefers the grand total over the products subtotal', () => {
      const lines = layout([
        [300, [380, 'Total dos produtos'], [480, '2.388,90']],
        [312, [380, 'Frete'], [480, '30,00']],
        [324, [380, 'Total da nota'], [480, '2.418,90']],
      ]);

      expect(extractHeader(lines).totalAmount).toBe(2418.9);
    });

    it('reads a DANFE box with the value under the label', () => {
      const lines = layout([
        [300, [40, 'VALOR TOTAL DA NOTA']],
        [312, [40, '2.418,90']],
      ]);

      expect(extractHeader(lines).totalAmount).toBe(2418.9);
    });

    it('does not take a table column called Total for the grand total', () => {
      // Header lines only reach here without the table, but a stray generic
      // "Total" over a number must not read downwards.
      const lines = layout([
        [100, [480, 'Vl. Total']],
        [112, [480, '94,50']],
      ]);

      expect(extractHeader(lines).totalAmount).toBeUndefined();
    });

    it('does not read an item count as an amount', () => {
      expect(
        extractHeader(layout([[300, [40, 'Total: 12 itens']]])).totalAmount,
      ).toBeUndefined();
    });

    it('falls back to the products total when it is the only one', () => {
      const lines = layout([
        [300, [380, 'Total dos produtos'], [480, '2.388,90']],
      ]);

      expect(extractHeader(lines).totalAmount).toBe(2388.9);
    });
  });
});
