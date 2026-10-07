import { PurchaseInvoice } from '@prisma/client';

import { buildDocumentKey } from '../../../src/modules/stock-entry/document-key';
import { ExtractionService } from '../../../src/modules/stock-entry/extraction.service';
import { EXTRACTION_TIMEOUT_MS } from '../../../src/modules/stock-entry/stock-entry.constants';
import { StockEntryRepository } from '../../../src/modules/stock-entry/stock-entry.repository';
import {
  ExtractionInput,
  ExtractionResult,
} from '../../../src/modules/extraction';
import { LineMatch, MatchItemService } from '../../../src/modules/item-match';
import { SupplierService } from '../../../src/modules/supplier';
import { FakeStockEntryRepository, FakeStorage } from './testing/fakes';

const USER_ID = 'user-1';
const INVOICE_ID = '5f3b7d0c-2a1e-4c7b-9a11-1f2e3d4c5b6a';
const KEY = buildDocumentKey(USER_ID, INVOICE_ID);
const PDF = new TextEncoder().encode('%PDF-1.7');

const READ: ExtractionResult = {
  status: 'success',
  supplier: { cnpj: '11222333000181', name: 'Distribuidora Exemplo Ltda' },
  invoiceNumber: '4521',
  orderDate: '2026-08-12',
  totalAmount: 94.5,
  items: [
    {
      extractedDescription: 'PROPOFOL 1% 20ML AMP',
      quantity: 5,
      unitValue: 18.9,
      totalValue: 94.5,
      arithmeticCheck: true,
    },
  ],
};

const PRESELECTED: LineMatch = {
  decision: 'preselected',
  itemId: 'propofol',
  reason: 'FUZZY',
  confidence: 0.912,
  candidates: [
    {
      itemId: 'propofol',
      name: 'Propofol 1% 20ml',
      unit: 'VIAL',
      score: 0.912,
    },
  ],
};

class FakeExtractor {
  readonly inputs: ExtractionInput[] = [];
  answer: () => Promise<ExtractionResult> = () => Promise.resolve(READ);

  extract(input: ExtractionInput) {
    this.inputs.push(input);
    return this.answer();
  }
}

describe('ExtractionService', () => {
  let repository: FakeStockEntryRepository;
  let extractor: FakeExtractor;
  let matchLines: jest.Mock;
  let findIdByTaxId: jest.Mock;
  let service: ExtractionService;

  const draft = (fields: Partial<PurchaseInvoice> = {}) => {
    repository.invoice = {
      id: INVOICE_ID,
      userId: USER_ID,
      status: 'DRAFT',
      extractionStatus: 'PENDING',
      failureReason: null,
      fileMimeType: 'application/pdf',
      supplierId: null,
      number: null,
      issueDate: null,
      totalAmount: null,
      rawExtraction: null,
      updatedAt: new Date(),
      ...fields,
    } as PurchaseInvoice;
  };

  beforeEach(() => {
    repository = new FakeStockEntryRepository();
    draft();
    const storage = new FakeStorage();
    storage.put(
      KEY,
      { contentLength: PDF.length, contentType: 'application/pdf' },
      PDF,
    );
    extractor = new FakeExtractor();
    matchLines = jest.fn().mockResolvedValue([PRESELECTED]);
    findIdByTaxId = jest.fn().mockResolvedValue('supplier-1');

    service = new ExtractionService(
      repository as unknown as StockEntryRepository,
      storage,
      extractor,
      { matchLines } as unknown as MatchItemService,
      { findIdByTaxId } as unknown as SupplierService,
    );
  });

  const run = () => service.run(repository.invoice as PurchaseInvoice);

  it('reads the stored PDF and keeps what the review starts from', async () => {
    await run();

    expect(extractor.inputs).toEqual([
      { buffer: PDF, mimeType: 'application/pdf', userId: USER_ID },
    ]);
    expect(matchLines).toHaveBeenCalledWith(
      USER_ID,
      ['PROPOFOL 1% 20ML AMP'],
      'supplier-1',
    );
    expect(repository.invoice).toMatchObject({
      extractionStatus: 'SUCCESS',
      failureReason: null,
      number: '4521',
      issueDate: new Date('2026-08-12'),
      totalAmount: 94.5,
      supplierId: 'supplier-1',
      rawExtraction: { result: READ, matches: [PRESELECTED] },
    });
  });

  it('matches without a supplier when the CNPJ is none of the user', async () => {
    findIdByTaxId.mockResolvedValue(undefined);

    await run();

    expect(matchLines).toHaveBeenCalledWith(
      USER_ID,
      ['PROPOFOL 1% 20ML AMP'],
      undefined,
    );
    expect(repository.invoice?.supplierId).toBeNull();
  });

  it('fails a scan with NO_TEXT_LAYER and matches nothing', async () => {
    extractor.answer = () =>
      Promise.resolve({
        status: 'failed',
        failureReason: 'no_text_layer',
        items: [],
      });

    await run();

    expect(repository.invoice).toMatchObject({
      extractionStatus: 'FAILED',
      failureReason: 'NO_TEXT_LAYER',
    });
    expect(matchLines).not.toHaveBeenCalled();
  });

  it('keeps the header of a document whose table it could not find', async () => {
    extractor.answer = () =>
      Promise.resolve({
        status: 'failed',
        failureReason: 'no_table_found',
        invoiceNumber: '4521',
        items: [],
      });

    await run();

    expect(repository.invoice).toMatchObject({
      extractionStatus: 'FAILED',
      failureReason: 'NO_TABLE_FOUND',
      number: '4521',
    });
  });

  it('fails with TIMEOUT when the reading takes too long', async () => {
    jest.useFakeTimers();
    try {
      extractor.answer = () => new Promise(() => {});

      const running = run();
      await jest.advanceTimersByTimeAsync(EXTRACTION_TIMEOUT_MS);
      await running;

      expect(repository.invoice).toMatchObject({
        extractionStatus: 'FAILED',
        failureReason: 'TIMEOUT',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('goes back to PENDING when something breaks mid-read, so a retry reads again', async () => {
    matchLines.mockRejectedValue(new Error('database down'));

    await expect(run()).rejects.toThrow('database down');

    expect(repository.invoice?.extractionStatus).toBe('PENDING');
  });

  it('does not read a document twice', async () => {
    draft({ extractionStatus: 'SUCCESS' });

    await expect(run()).resolves.toMatchObject({ extractionStatus: 'SUCCESS' });
    expect(extractor.inputs).toHaveLength(0);
  });

  it('leaves a reading in progress to the request running it', async () => {
    draft({ extractionStatus: 'PROCESSING' });

    await expect(run()).resolves.toMatchObject({
      extractionStatus: 'PROCESSING',
    });
    expect(extractor.inputs).toHaveLength(0);
  });

  it('takes over a reading left PROCESSING by a process that died', async () => {
    draft({
      extractionStatus: 'PROCESSING',
      updatedAt: new Date(Date.now() - 3 * EXTRACTION_TIMEOUT_MS),
    });

    await run();

    expect(repository.invoice?.extractionStatus).toBe('SUCCESS');
  });

  describe('view', () => {
    it('answers the header from the invoice and each line with its match', async () => {
      const invoice = await run();

      expect(service.view(invoice)).toEqual({
        status: 'SUCCESS',
        supplierId: 'supplier-1',
        supplier: READ.supplier,
        invoiceNumber: '4521',
        orderDate: '2026-08-12',
        totalAmount: 94.5,
        items: [{ ...READ.items[0], match: PRESELECTED }],
      });
    });

    it('warns that a long document was read in part', async () => {
      extractor.answer = () =>
        Promise.resolve({
          ...READ,
          partial: { pagesRead: 50, totalPages: 62 },
        });

      const invoice = await run();

      expect(service.view(invoice).partial).toEqual({
        pagesRead: 50,
        totalPages: 62,
      });
    });

    it('answers a photo with no items', () => {
      draft({ extractionStatus: 'MANUAL', fileMimeType: 'image/jpeg' });

      expect(service.view(repository.invoice as PurchaseInvoice)).toEqual({
        status: 'MANUAL',
        items: [],
      });
    });
  });
});
