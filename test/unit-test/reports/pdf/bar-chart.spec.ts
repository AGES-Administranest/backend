import { barChartSvg } from '../../../../src/modules/reports/pdf/bar-chart';

const series = [
  { name: 'Entradas', color: '#2e7d5b' },
  { name: 'Saídas', color: '#c0504d' },
];

describe('barChartSvg', () => {
  it('draws one bar per series for each group', () => {
    const svg = barChartSvg(
      [
        { label: 'out/2026', values: [1500, 285] },
        { label: 'nov/2026', values: [800, 122.33] },
      ],
      series,
    );

    expect(svg.startsWith('<svg')).toBe(true);
    // 4 bars and the 2 legend squares
    expect(svg.match(/<rect /g)).toHaveLength(6);
    expect(svg).toContain('out/2026');
    expect(svg).toContain('Entradas');
  });

  it('draws no bar for a negative value and survives an empty period', () => {
    expect(barChartSvg([{ label: 'x', values: [-10, 0] }], series)).toContain(
      'height="0"',
    );
    expect(barChartSvg([], series)).toContain('</svg>');
  });

  it('escapes the labels', () => {
    expect(barChartSvg([{ label: 'a<b&c', values: [1, 1] }], series)).toContain(
      'a&lt;b&amp;c',
    );
  });
});
