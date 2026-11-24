import { Prisma } from '@prisma/client';

import { StockEntryDraftService } from '../../../src/modules/stock-entry/stock-entry-draft.service';

const USER = 'user-1';
const ID = 'invoice-1';
const ISSUED = new Date('2026-10-20T00:00:00.000Z');

const draft = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  userId: USER,
  status: 'DRAFT',
  totalAmount: new Prisma.Decimal(50),
  issueDate: ISSUED,
  number: '4521',
  ...overrides,
});

describe('StockEntryDraftService.confirm', () => {
  const tx = {};
  let repository: { findByIdAndUser: jest.Mock; confirmDraft: jest.Mock };
  let financial: { recordPurchaseInvoice: jest.Mock };
  let service: StockEntryDraftService;

  beforeEach(() => {
    repository = {
      findByIdAndUser: jest.fn().mockResolvedValue(draft()),
      confirmDraft: jest.fn(
        async (
          _id: string,
          _userId: string,
          write: (inside: unknown) => Promise<void>,
        ) => {
          await write(tx);
          return true;
        },
      ),
    };
    financial = { recordPurchaseInvoice: jest.fn() };
    service = new StockEntryDraftService(
      repository as never,
      {} as never,
      {} as never,
      financial as never,
      {} as never,
    );
  });

  it('posts the expense in the transaction that confirms the draft', async () => {
    await service.confirm(USER, ID);

    expect(financial.recordPurchaseInvoice).toHaveBeenCalledWith(
      {
        userId: USER,
        purchaseInvoiceId: ID,
        amount: new Prisma.Decimal(50),
        issueDate: ISSUED,
        number: '4521',
      },
      tx,
    );
  });

  it.each([
    [{ totalAmount: null }],
    [{ totalAmount: new Prisma.Decimal(0) }],
    [{ totalAmount: new Prisma.Decimal(-1) }],
    [{ issueDate: null }],
  ])('refuses a draft that is not ready: %j', async overrides => {
    repository.findByIdAndUser.mockResolvedValue(draft(overrides));

    await expect(service.confirm(USER, ID)).rejects.toMatchObject({
      code: 'INVOICE_NOT_READY',
    });
    expect(repository.confirmDraft).not.toHaveBeenCalled();
  });

  it('refuses the entry of someone else', async () => {
    repository.findByIdAndUser.mockResolvedValue(null);

    await expect(service.confirm(USER, ID)).rejects.toMatchObject({
      kind: 'NOT_FOUND',
    });
  });

  it('refuses an entry already confirmed, before or during the call', async () => {
    const expected = { code: 'INVOICE_NOT_EDITABLE' };
    repository.confirmDraft.mockResolvedValue(false);
    await expect(service.confirm(USER, ID)).rejects.toMatchObject(expected);

    repository.findByIdAndUser.mockResolvedValue(
      draft({ status: 'CONFIRMED' }),
    );
    await expect(service.confirm(USER, ID)).rejects.toMatchObject(expected);
    expect(financial.recordPurchaseInvoice).not.toHaveBeenCalled();
  });
});
