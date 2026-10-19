type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjs: Pdfjs | undefined;

/**
 * pdf.js is ESM only. Node's own `require` loads it both in the API and under
 * Jest, whose module registry cannot. Loaded on first use, not at boot.
 */
export function loadPdfjs(): Pdfjs {
  pdfjs ??= process.getBuiltinModule('module').createRequire(__filename)(
    'pdfjs-dist/legacy/build/pdf.mjs',
  ) as Pdfjs;
  return pdfjs;
}
