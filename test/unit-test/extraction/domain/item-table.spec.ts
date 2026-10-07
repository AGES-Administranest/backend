import { extractItems } from '../../../../src/modules/extraction/domain/item-table';
import {
  groupLines,
  lineText,
} from '../../../../src/modules/extraction/domain/text-lines';
import { fragment, layout, pages } from '../testing/layout';

const HEADER: [number, ...[number, string][]] = [
  100,
  [40, 'Descrição'],
  [300, 'Qtd'],
  [380, 'Vl. Unit.'],
  [480, 'Vl. Total'],
];

const itemsOf = (rows: Parameters<typeof layout>[0]) =>
  extractItems(layout(rows)).items;

describe('extractItems', () => {
  it('reads each row into the column under its header', () => {
    expect(
      itemsOf([
        HEADER,
        [
          115,
          [40, 'PROPOFOL 10MG/ML F/A 20ML'],
          [300, '5'],
          [380, '18,90'],
          [480, '94,50'],
        ],
        [
          130,
          [40, 'CETAMINA 10% 50ML'],
          [300, '2'],
          [380, '45,00'],
          [480, '90,00'],
        ],
      ]),
    ).toEqual([
      {
        extractedDescription: 'PROPOFOL 10MG/ML F/A 20ML',
        quantity: 5,
        unitValue: 18.9,
        totalValue: 94.5,
        arithmeticCheck: true,
      },
      {
        extractedDescription: 'CETAMINA 10% 50ML',
        quantity: 2,
        unitValue: 45,
        totalValue: 90,
        arithmeticCheck: true,
      },
    ]);
  });

  it('places right-aligned numbers under their label', () => {
    // "1.234,50" ends where "Vl. Unit." ends, starting left of the label.
    const [item] = itemsOf([
      HEADER,
      [
        115,
        [40, 'ISOFLURANO 100ML'],
        [300, '1'],
        [371, '1.234,50'],
        [471, '1.234,50'],
      ],
    ]);

    expect(item).toMatchObject({ quantity: 1, unitValue: 1234.5 });
  });

  it('flags a row whose numbers do not close instead of dropping it', () => {
    const [item] = itemsOf([
      HEADER,
      [
        115,
        [40, 'CLORIDRATO DE CETAMINA 10ML'],
        [300, '12'],
        [380, '8,40'],
        [480, '118,00'],
      ],
    ]);

    expect(item).toMatchObject({ totalValue: 118, arithmeticCheck: false });
  });

  it('keeps a row with missing values, leaving them out', () => {
    const items = itemsOf([
      HEADER,
      [115, [40, 'LUVA CIRÚRGICA 7,5 PAR'], [300, '25'], [480, '—']],
      [
        130,
        [40, 'AGULHA 40X12 CX C/100UN'],
        [300, '0'],
        [380, '18,70'],
        [480, '0,00'],
      ],
    ]);

    expect(items).toEqual([
      {
        extractedDescription: 'LUVA CIRÚRGICA 7,5 PAR',
        quantity: 25,
        arithmeticCheck: false,
      },
      {
        extractedDescription: 'AGULHA 40X12 CX C/100UN',
        quantity: 0,
        unitValue: 18.7,
        totalValue: 0,
        arithmeticCheck: true,
      },
    ]);
  });

  it('appends a wrapped description to its item', () => {
    const [item] = itemsOf([
      HEADER,
      [
        115,
        [40, 'SERINGA DESCARTÁVEL 10ML'],
        [300, '5'],
        [380, '48,00'],
        [480, '240,00'],
      ],
      [126, [40, 'C/ AGULHA 25X7 CX C/100']],
    ]);

    expect(item.extractedDescription).toBe(
      'SERINGA DESCARTÁVEL 10ML C/ AGULHA 25X7 CX C/100',
    );
  });

  it('keeps a wrapped description that sits right above the totals', () => {
    // The totals line has numbers and no description, like the second half of
    // a two-line item — it must not be read as one.
    const [item] = itemsOf([
      HEADER,
      [
        115,
        [40, 'SERINGA DESCARTÁVEL 10ML'],
        [300, '5'],
        [380, '48,00'],
        [480, '240,00'],
      ],
      [126, [40, 'C/ AGULHA 25X7']],
      [140, [380, 'Total do pedido:'], [480, 'R$ 240,00']],
    ]);

    expect(item.extractedDescription).toBe(
      'SERINGA DESCARTÁVEL 10ML C/ AGULHA 25X7',
    );
  });

  it('joins a description with the numbers printed on the line below it', () => {
    const items = itemsOf([
      HEADER,
      [115, [40, 'FITA MICROPOROSA 25MM X 10M']],
      [126, [300, '10'], [380, '6,90'], [480, '69,00']],
    ]);

    expect(items).toEqual([
      {
        extractedDescription: 'FITA MICROPOROSA 25MM X 10M',
        quantity: 10,
        unitValue: 6.9,
        totalValue: 69,
        arithmeticCheck: true,
      },
    ]);
  });

  it('keeps unit and code columns out of the description and the numbers', () => {
    const [item] = itemsOf([
      [
        100,
        [20, 'Cód.'],
        [70, 'Produto'],
        [280, 'Un'],
        [320, 'Qtde'],
        [380, 'Preço Unit.'],
        [480, 'Total'],
      ],
      [
        115,
        [20, '10442'],
        [70, 'CATETER IV 22G'],
        [280, 'CX'],
        [320, '10'],
        [380, '6,90'],
        [480, '69,00'],
      ],
    ]);

    expect(item).toEqual({
      extractedDescription: 'CATETER IV 22G',
      quantity: 10,
      unitValue: 6.9,
      totalValue: 69,
      arithmeticCheck: true,
    });
  });

  it('reads a quantity with the unit glued to it', () => {
    const [item] = itemsOf([
      HEADER,
      [
        115,
        [40, 'PROPOFOL 1% 20ML'],
        [300, '20 FR'],
        [380, '22,50'],
        [480, '450,00'],
      ],
    ]);

    expect(item.quantity).toBe(20);
  });

  it('reads a header split over two lines', () => {
    const [item] = itemsOf([
      [100, [40, 'Descrição'], [300, 'Qtd'], [380, 'Valor'], [480, 'Valor']],
      [111, [380, 'Unit.'], [480, 'Total']],
      [
        126,
        [40, 'VACINA V10 CANINA'],
        [300, '3'],
        [380, '32,00'],
        [480, '96,00'],
      ],
    ]);

    expect(item).toMatchObject({ unitValue: 32, totalValue: 96 });
  });

  it('stops at the totals under the table', () => {
    const table = extractItems(
      layout([
        HEADER,
        [
          115,
          [40, 'PROPOFOL 1% 20ML'],
          [300, '5'],
          [380, '18,90'],
          [480, '94,50'],
        ],
        [140, [380, 'Total do pedido'], [480, '94,50']],
        [155, [40, 'Observações: entregar pela manhã 10 caixas']],
      ]),
    );

    expect(table.items).toHaveLength(1);
    // The totals line stays out of the table, for the header extraction.
    expect([...table.lines].map(lineText)).not.toContain(
      'Total do pedido  94,50',
    );
  });

  it('continues a table on the next page, with or without the header', () => {
    const row = (y: number, name: string): [number, ...[number, string][]] => [
      y,
      [40, name],
      [300, '1'],
      [380, '10,00'],
      [480, '10,00'],
    ];

    const items = extractItems(
      pages(
        [
          [
            HEADER,
            row(115, 'ITEM A'),
            row(130, 'ITEM B'),
            [800, [40, 'Continua na próxima página']],
          ],
          1,
        ],
        [[[40, [40, 'Página 2 de 3']], row(70, 'ITEM C')], 2],
        [[HEADER, row(115, 'ITEM D')], 3],
      ),
    ).items;

    expect(items.map(item => item.extractedDescription)).toEqual([
      'ITEM A',
      'ITEM B',
      'ITEM C',
      'ITEM D',
    ]);
  });

  it('does not carry a table closed by its totals into the next page', () => {
    const items = extractItems(
      pages(
        [
          [
            HEADER,
            [115, [40, 'ITEM A'], [300, '1'], [380, '10,00'], [480, '10,00']],
            [130, [380, 'Total'], [480, '10,00']],
          ],
          1,
        ],
        [[[70, [40, 'Condições gerais'], [300, '30'], [380, 'dias']]], 2],
      ),
    ).items;

    expect(items.map(item => item.extractedDescription)).toEqual(['ITEM A']);
  });

  it('drops a description that never gets numbers, like a section title', () => {
    const items = itemsOf([
      HEADER,
      [115, [40, 'ANESTÉSICOS']],
      [
        130,
        [40, 'PROPOFOL 1% 20ML'],
        [300, '5'],
        [380, '18,90'],
        [480, '94,50'],
      ],
    ]);

    expect(items.map(item => item.extractedDescription)).toEqual([
      'PROPOFOL 1% 20ML',
    ]);
  });

  describe('a DANFE product table', () => {
    // Header over three lines, tax columns full of 0,00, the description label
    // centred over a column that starts further left, and the lot on a line of
    // its own that begins left of where the description is printed.
    const danfe = layout([
      [100, [383, 'VALOR'], [423, 'VALOR'], [463, 'B. CÁLC.'], [513, 'VALOR']],
      [
        112,
        [18, 'CÓDIGO'],
        [96, 'DESCRIÇÃO DO PRODUTO'],
        [244, 'NCM/SH'],
        [322, 'UN.'],
        [345, 'QUANT.'],
      ],
      [124, [386, 'UNIT.'], [423, 'TOTAL.'], [466, 'ICMS'], [516, 'ICMS']],
      [
        139,
        [22, '1204'],
        [58, 'CETAMIN 10% INJ 10ML'],
        [244, '30049099'],
        [323, 'FR'],
        [349, '4,0000'],
        [388, '54,90'],
        [420, '219,60'],
        [468, '0,00'],
        [518, '0,00'],
      ],
      [150, [50, 'Lote: CT250871 Val: 31/08/2027']],
    ]);

    it('reads the values from their columns and leaves the taxes out', () => {
      expect(extractItems(danfe).items).toEqual([
        {
          extractedDescription:
            'CETAMIN 10% INJ 10ML Lote: CT250871 Val: 31/08/2027',
          quantity: 4,
          unitValue: 54.9,
          totalValue: 219.6,
          arithmeticCheck: true,
        },
      ]);
    });
  });

  it('does not take the 0,00 of tax columns for an item', () => {
    // No header to trust: 0 × 0 = 0 closes, but says nothing about the line.
    const items = itemsOf([
      [
        100,
        [40, 'PROPOFOL 1% 20ML'],
        [300, '5'],
        [340, '18,90'],
        [390, '94,50'],
        [440, '0,00'],
        [470, '0,00'],
        [500, '0,00'],
      ],
    ]);

    expect(items).toEqual([
      {
        extractedDescription: 'PROPOFOL 1% 20ML',
        quantity: 5,
        unitValue: 18.9,
        totalValue: 94.5,
        arithmeticCheck: true,
      },
    ]);
  });

  it('splits a truncated description glued to the next column', () => {
    const [item] = itemsOf([
      [
        100,
        [30, 'Cód.'],
        [75, 'Descrição'],
        [290, 'Fabricante'],
        [385, 'Qtd.'],
        [430, 'Preço Unit.'],
        [500, 'Total'],
      ],
      [
        115,
        [30, '10728'],
        [75, 'CIRCUITO PEDIATRICO BARAKA (MAPLESON D) 1,5 INTERSURGICAL'],
        [385, '2,00'],
        [430, '68,4500'],
        [500, '136,90'],
      ],
    ]);

    expect(item).toEqual({
      extractedDescription: 'CIRCUITO PEDIATRICO BARAKA (MAPLESON D) 1,5',
      quantity: 2,
      unitValue: 68.45,
      totalValue: 136.9,
      arithmeticCheck: true,
    });
  });

  describe('a truncated description glued to a lot column', () => {
    const SLIP_HEADER: [number, ...[number, string][]] = [
      100,
      [30, 'Item'],
      [60, 'Descrição do Produto'],
      [260, 'Lote'],
      [330, 'Un'],
      [360, 'Qtde'],
      [400, 'Vlr Unit'],
      [470, 'Vlr Total'],
    ];
    const VALUES: [number, string][] = [
      [330, 'BL'],
      [370, '30'],
      [420, '3,89'],
      [485, '116,70'],
    ];

    it('splits off a lot code that runs past its label', () => {
      const [item] = itemsOf([
        SLIP_HEADER,
        // One PDF run; the lot code ends past halfway to "Un".
        [
          115,
          [30, '1'],
          [62, 'SORO FISIOLOGICO 0,9% BOLSA 250ML HALEX HI25K5053'],
          ...VALUES,
        ],
      ]);

      expect(item.extractedDescription).toBe(
        'SORO FISIOLOGICO 0,9% BOLSA 250ML HALEX',
      );
    });

    it('places the words by their own run, not by the whole cell', () => {
      // Narrow lowercase-like glyphs, then a lot code in wide ones: spread over
      // the whole cell, the final "10" would land under "Lote".
      const header = layout([SLIP_HEADER]);
      const row = groupLines([
        {
          page: 1,
          fragments: [
            fragment('1', 30, 115),
            {
              ...fragment('CLORIDRATO DE CETAMINA 10% FRASCO 10', 92, 115),
              width: 162,
            },
            { ...fragment('XF9685N', 260, 115), width: 45 },
            ...VALUES.map(([x, text]) => fragment(text, x, 115)),
          ],
        },
      ]);

      const [item] = extractItems([...header, ...row]).items;

      expect(item.extractedDescription).toBe(
        'CLORIDRATO DE CETAMINA 10% FRASCO 10',
      );
    });
  });

  it('joins a hyphenated word broken at the line end, but keeps a separating dash apart', () => {
    const items = itemsOf([
      HEADER,
      [
        115,
        [40, 'PROPOFOL 50ML (PROVIVE) -'],
        [300, '1'],
        [380, '10,00'],
        [480, '10,00'],
      ],
      [126, [40, 'FRESENIUS']],
      [
        140,
        [40, 'CITRATO DE FENTANILA FRASCO-'],
        [300, '1'],
        [380, '10,00'],
        [480, '10,00'],
      ],
      [151, [40, 'AMPOLA 10ML']],
    ]);

    expect(items.map(item => item.extractedDescription)).toEqual([
      'PROPOFOL 50ML (PROVIVE) - FRESENIUS',
      'CITRATO DE FENTANILA FRASCO-AMPOLA 10ML',
    ]);
  });

  it('keeps reading when each item takes several lines', () => {
    // The gap between two item rows is wide, but every line in between
    // belongs to the first item: that is not the end of the page.
    const items = itemsOf([
      HEADER,
      [
        115,
        [40, 'SERINGA DESCARTAVEL 20ML S/ AGULHA'],
        [300, '10'],
        [380, '0,80'],
        [480, '8,00'],
      ],
      [126, [40, 'BICO LUER SLIP ESTERIL - SR']],
      [137, [40, 'Lote: 2410266 Val: 31/10/2029']],
      [148, [40, 'Registro ANVISA 10123450001']],
      [
        159,
        [40, 'LUVA CIRURGICA 7,5'],
        [300, '2'],
        [380, '5,00'],
        [480, '10,00'],
      ],
    ]);

    expect(items.map(item => item.extractedDescription)).toEqual([
      'SERINGA DESCARTAVEL 20ML S/ AGULHA BICO LUER SLIP ESTERIL - SR Lote: 2410266 Val: 31/10/2029 Registro ANVISA 10123450001',
      'LUVA CIRURGICA 7,5',
    ]);
  });

  describe('without a header', () => {
    it('takes the lines whose last three numbers close the arithmetic', () => {
      const items = itemsOf([
        [
          100,
          [40, 'PROPOFOL 1% 20ML'],
          [300, '5'],
          [380, '18,90'],
          [480, '94,50'],
        ],
        [115, [40, 'Pedido 4521'], [300, '12/08/2026']],
        [130, [40, 'CETAMINA'], [300, '2'], [380, '45,00'], [480, '99,00']],
      ]);

      expect(items).toEqual([
        {
          extractedDescription: 'PROPOFOL 1% 20ML',
          quantity: 5,
          unitValue: 18.9,
          totalValue: 94.5,
          arithmeticCheck: true,
        },
      ]);
    });
  });

  it('answers no items when there is no table', () => {
    expect(
      itemsOf([
        [100, [40, 'Pedido 4521']],
        [115, [40, 'Obrigado pela preferência']],
      ]),
    ).toEqual([]);
  });
});
