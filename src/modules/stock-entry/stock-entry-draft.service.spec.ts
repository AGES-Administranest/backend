import { Prisma, PurchaseInvoice } from '@prisma/client';

import { ExtractionService, StoredExtraction } from './extraction.service';
import { StockEntryDraftService } from './stock-entry-draft.service';
import { StockEntryRepository } from './stock-entry.repository';
import { ItemService } from '../item';
import { MatchItemService } from '../item-match';
import { SupplierService } from '../supplier';
import { FakeStockEntryRepository, FakeStorage } from './testing/fakes';

const USER_ID = 'user-1';
const INVOICE_ID = '5f3b7d0c-2a1e-4c7b-9a11-1f2e3d4c5b6a';
const PROPOFOL = {
  id: 'propofol',
  name: 'Propofol 1% amp 20ml',
  unit: 'AMPOULE' as const,
};

const STORED: StoredExtraction = {
  result: {
    status: 'success',
    supplier: { name: 'Vet Distribuidora' },
    items: [
      {
        extractedDescription: 'PROPOFOL 1% 20ML AMP',
        quantity: 5,
        unitValue: 18.9,
        totalValue: 94.5,
        arithmeticCheck: true,
      },
    ],
  },
  matches: [
    {
      decision: 'preselected',
      itemId: PROPOFOL.id,
      reason: 'FUZZY',
      confidence: 0.9,
      candidates: [
        {
          itemId: PROPOFOL.id,
          name: PROPOFOL.name,
          unit: PROPOFOL.unit,
          score: 0.9,
        },
      ],
    },
  ],
};

/** The catalog as `ItemService.findActiveIds` filters it. */
const CATALOG = [
  { id: PROPOFOL.id, userId: USER_ID, active: true },
  { id: 'ketamine', userId: 'someone-else', active: true },
  { id: 'deleted-item', userId: USER_ID, active: false },
];

describe('StockEntryDraftService', () => {
  let service: StockEntryDraftService;
  let repository: FakeStockEntryRepository;
  let recordPurchaseInvoice: jest.Mock;
  /** Runs while the service checks the items: another request's moment. */
  let meanwhile: () => void;

  beforeEach(() => {
    repository = new FakeStockEntryRepository();
    repository.catalog.set(PROPOFOL.id, PROPOFOL);
    meanwhile = () => undefined;
    const items = {
      findActiveIds: (userId: string, ids: string[]) => {
        meanwhile();
        return Promise.resolve(
          ids.filter(id =>
            CATALOG.some(
              item => item.id === id && item.userId === userId && item.active,
            ),
          ),
        );
      },
    };
    const extraction = new ExtractionService(
      repository as unknown as StockEntryRepository,
      new FakeStorage(),
      { extract: jest.fn() },
      {} as MatchItemService,
      {} as SupplierService,
    );
    recordPurchaseInvoice = jest.fn();
    service = new StockEntryDraftService(
      repository as unknown as StockEntryRepository,
      extraction,
      items as unknown as ItemService,
      { recordPurchaseInvoice } as never,
    );
    draft();
  });

  function draft(fields: Partial<PurchaseInvoice> = {}) {
    repository.invoice = {
      id: INVOICE_ID,
      userId: USER_ID,
      status: 'DRAFT',
      extractionStatus: 'SUCCESS',
      failureReason: null,
      fileName: 'pedido-4521.pdf',
      fileMimeType: 'application/pdf',
      fileHash: 'a'.repeat(64),
      supplierId: null,
      number: '4521',
      issueDate: new Date('2026-08-12T00:00:00.000Z'),
      totalAmount: null,
      rawExtraction: STORED,
      uploadedAt: new Date('2026-09-28T12:00:00.000Z'),
      updatedAt: new Date('2026-09-28T12:00:00.000Z'),
      ...fields,
    } as PurchaseInvoice;
  }

  describe('listing', () => {
    it('shows a draft with the supplier as printed when none is registered', async () => {
      expect(await service.listDrafts(USER_ID)).toEqual([
        {
          id: INVOICE_ID,
          fileName: 'pedido-4521.pdf',
          fileMimeType: 'application/pdf',
          supplierName: 'Vet Distribuidora',
          invoiceNumber: '4521',
          orderDate: '2026-08-12',
          extractionStatus: 'SUCCESS',
          uploadedAt: '2026-09-28T12:00:00.000Z',
          updatedAt: '2026-09-28T12:00:00.000Z',
        },
      ]);
    });

    it('leaves out an entry that is no longer a draft', async () => {
      draft({ status: 'CANCELLED' });

      expect(await service.listDrafts(USER_ID)).toEqual([]);
    });
  });

  describe('reading back', () => {
    it('has no saved lines until the review is saved, next to the reading', async () => {
      const detail = await service.getDraft(USER_ID, INVOICE_ID);

      expect(detail.lines).toEqual([]);
      expect(detail.extraction.items).toHaveLength(1);
    });

    it("answers not found for someone else's draft", async () => {
      await expect(
        service.getDraft('someone-else', INVOICE_ID),
      ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
    });
  });

  describe('saving lines', () => {
    it('reads back what was saved, with the item and what the reading suggested', async () => {
      await service.replaceLines(USER_ID, INVOICE_ID, {
        lines: [
          {
            sourceIndex: 0,
            description: 'PROPOFOL 1% 20ML AMP',
            itemId: PROPOFOL.id,
            quantity: 5,
            unitCost: 18.9,
            lotNumber: 'PF8821',
            expirationDate: '2027-05-31',
          },
          { description: '' },
        ],
      });

      const { lines } = await service.getDraft(USER_ID, INVOICE_ID);
      expect(lines).toEqual([
        {
          sourceIndex: 0,
          description: 'PROPOFOL 1% 20ML AMP',
          item: PROPOFOL,
          quantity: 5,
          unitCost: 18.9,
          lotNumber: 'PF8821',
          expirationDate: '2027-05-31',
          candidates: STORED.matches[0].candidates,
        },
        { description: '', candidates: [] },
      ]);
    });

    it.each([
      ["someone else's", 'ketamine'],
      ['deleted from the catalog', 'deleted-item'],
      ['that does not exist', 'no-such-item'],
    ])('refuses an item %s, and keeps the lines', async (_label, itemId) => {
      await expect(
        service.replaceLines(USER_ID, INVOICE_ID, {
          lines: [{ description: 'X', itemId }],
        }),
      ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
      expect(repository.lines).toEqual([]);
    });

    it('refuses to change an entry that is no longer a draft', async () => {
      draft({ status: 'CONFIRMED' });

      await expect(
        service.replaceLines(USER_ID, INVOICE_ID, { lines: [] }),
      ).rejects.toMatchObject({ code: 'INVOICE_NOT_EDITABLE' });
    });

    it('does not write over a draft discarded while its items were checked', async () => {
      meanwhile = () => draft({ status: 'CANCELLED' });

      await expect(
        service.replaceLines(USER_ID, INVOICE_ID, {
          lines: [{ description: 'PROPOFOL', itemId: PROPOFOL.id }],
        }),
      ).rejects.toMatchObject({ code: 'INVOICE_NOT_EDITABLE' });
      expect(repository.lines).toEqual([]);
    });
  });

  describe('saving the header', () => {
    it('changes only what was sent, and clears what came as null', async () => {
      await service.updateHeader(USER_ID, INVOICE_ID, {
        totalAmount: 94.5,
        orderDate: null,
      });

      expect(repository.invoice).toMatchObject({
        number: '4521',
        issueDate: null,
        totalAmount: 94.5,
      });
    });

    it('refuses to change an entry that is no longer a draft, and leaves it as it was', async () => {
      draft({ status: 'CANCELLED' });

      await expect(
        service.updateHeader(USER_ID, INVOICE_ID, { invoiceNumber: '9999' }),
      ).rejects.toMatchObject({ code: 'INVOICE_NOT_EDITABLE' });
      expect(repository.invoice).toMatchObject({ number: '4521' });
    });
  });

  describe('confirmation', () => {
    it('posts an expense for the invoice total and marks the import confirmed', async () => {
      draft({ totalAmount: new Prisma.Decimal('94.50') });

      await service.confirm(USER_ID, INVOICE_ID);

      expect(recordPurchaseInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          purchaseInvoiceId: INVOICE_ID,
          number: '4521',
        }),
        expect.anything(),
      );
      expect(repository.invoice).toMatchObject({ status: 'CONFIRMED' });
    });

    it('refuses an invoice without a total', async () => {
      await expect(service.confirm(USER_ID, INVOICE_ID)).rejects.toMatchObject({
        code: 'INVOICE_NOT_READY',
      });
      expect(recordPurchaseInvoice).not.toHaveBeenCalled();
    });
  });

  describe('discarding', () => {
    it('cancels the draft and frees its file for a new entry', async () => {
      await service.discard(USER_ID, INVOICE_ID);

      expect(repository.invoice).toMatchObject({
        status: 'CANCELLED',
        fileHash: null,
      });
    });

    it("answers not found for someone else's draft, and leaves it a draft", async () => {
      await expect(
        service.discard('someone-else', INVOICE_ID),
      ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
      expect(repository.invoice).toMatchObject({ status: 'DRAFT' });
    });
  });
});
