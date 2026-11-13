export interface BarGroup {
  label: string;
  /** One value per series, in the order of `ChartSeries`. */
  values: number[];
}

export interface ChartSeries {
  name: string;
  color: string;
}

const WIDTH = 500;
const HEIGHT = 200;
const PAD = { top: 24, right: 8, bottom: 26, left: 54 };
const GRID_LINES = 4;

const compact = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A grouped bar chart as an SVG string, which pdfmake draws as vectors. No
 * canvas and no browser: the API runs on a small instance (ADR-04).
 *
 * Bars only show amounts at or above zero; a negative value draws no bar, and
 * the table next to the chart is what states it.
 */
export function barChartSvg(
  groups: readonly BarGroup[],
  series: readonly ChartSeries[],
): string {
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const baseline = PAD.top + innerHeight;
  const max = Math.max(1, ...groups.flatMap(group => group.values));
  const slot = innerWidth / Math.max(groups.length, 1);
  const barWidth = Math.min(36, (slot * 0.7) / series.length);
  const y = (value: number) => baseline - (value / max) * innerHeight;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
  ];

  for (let line = 0; line <= GRID_LINES; line++) {
    const value = (max / GRID_LINES) * line;
    parts.push(
      `<line x1="${PAD.left}" x2="${WIDTH - PAD.right}" y1="${y(value)}" y2="${y(value)}" stroke="#dddddd" stroke-width="0.5"/>`,
      `<text x="${PAD.left - 6}" y="${y(value) + 3}" font-size="8" text-anchor="end" fill="#666666">${compact.format(value)}</text>`,
    );
  }

  groups.forEach((group, index) => {
    const center = PAD.left + slot * index + slot / 2;
    const start = center - (barWidth * series.length) / 2;
    series.forEach((item, position) => {
      const value = Math.max(0, group.values[position] ?? 0);
      parts.push(
        `<rect x="${start + barWidth * position}" y="${y(value)}" width="${barWidth - 2}" height="${baseline - y(value)}" fill="${item.color}"/>`,
      );
    });
    parts.push(
      `<text x="${center}" y="${HEIGHT - 10}" font-size="9" text-anchor="middle" fill="#333333">${escapeXml(group.label)}</text>`,
    );
  });

  series.forEach((item, position) => {
    const x = PAD.left + position * 90;
    parts.push(
      `<rect x="${x}" y="6" width="8" height="8" fill="${item.color}"/>`,
      `<text x="${x + 12}" y="13" font-size="9" fill="#333333">${escapeXml(item.name)}</text>`,
    );
  });

  parts.push('</svg>');
  return parts.join('');
}
