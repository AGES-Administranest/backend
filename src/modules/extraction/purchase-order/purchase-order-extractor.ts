import { Injectable } from '@nestjs/common';

import { extractHeader, TableStart } from './header-fields';
import { extractItems } from './item-table';
import {
  PurchaseOrderFailureReason,
  PurchaseOrderResult,
} from './purchase-order-result';
import { PURCHASE_ORDER_SETTINGS } from './purchase-order-settings';
import { DocumentBytes, readPdfDocument } from '../core/pdf-document';
import { groupLines, PageText, TextLine } from '../core/text-lines';
import { DocumentExtractor } from '../document-extractor';

@Injectable()
export class PurchaseOrderExtractor extends DocumentExtractor<'purchase-order'> {
  readonly settings = PURCHASE_ORDER_SETTINGS;

  async extract(input: DocumentBytes): Promise<PurchaseOrderResult> {
    const document = await readPdfDocument(input);
    if (document.status === 'failed')
      return this.failed(document.failureReason);

    return {
      ...extractFromPages(document.pages),
      ...(document.partial && { partial: document.partial }),
    };
  }

  failed(failureReason: PurchaseOrderFailureReason): PurchaseOrderResult {
    return { status: 'failed', failureReason, items: [] };
  }
}

function extractFromPages(pages: PageText[]): PurchaseOrderResult {
  const lines = groupLines(pages);
  const table = extractItems(lines);
  // Table lines are left out: a "Total" column would read as the grand total.
  const header = extractHeader(
    lines.filter(line => !table.lines.has(line)),
    tableStartOf(lines, table.lines),
  );

  // Without items the header still prefills the manual entry.
  return table.items.length > 0
    ? { status: 'success', ...header, items: table.items }
    : {
        status: 'failed',
        failureReason: 'no_table_found',
        ...header,
        items: [],
      };
}

function tableStartOf(
  lines: TextLine[],
  tableLines: Set<TextLine>,
): TableStart | undefined {
  const first = lines.find(line => tableLines.has(line));
  return first ? { page: first.page, y: first.y } : undefined;
}
