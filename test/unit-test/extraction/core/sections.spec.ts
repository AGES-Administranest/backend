import { sectionsOf } from '../../../../src/modules/extraction/core/sections';
import { pages } from '../testing/layout';

const TITLES = [
  { title: /^tomador\b/, section: 'taker' },
  { title: /^servico\b/, section: 'other' },
];

describe('sectionsOf', () => {
  it('puts each line in the section of the last title above it', () => {
    const lines = pages([
      [
        [40, [40, 'Prefeitura de Exemplo']],
        [60, [40, 'TOMADOR DO SERVIÇO']],
        [72, [40, 'Clínica Exemplo']],
        [90, [40, '— Serviço prestado']],
      ],
      1,
    ]);

    expect([...sectionsOf(lines, TITLES, 'header').values()]).toEqual([
      'header',
      'taker',
      'taker',
      'other',
    ]);
  });

  it('starts every page over at the initial section', () => {
    const lines = pages(
      [[[40, [40, 'Tomador']]], 1],
      [[[40, [40, 'Clínica Exemplo']]], 2],
    );

    expect([...sectionsOf(lines, TITLES, 'header').values()]).toEqual([
      'taker',
      'header',
    ]);
  });
});
