import { Prisma } from '@prisma/client';

import {
  client,
  confirmationService,
  draftNote,
  FakeClients,
  FakeFinancialEntries,
  FakeServiceInvoicesRepository,
  INVOICE_ID,
  USER_ID,
} from './testing/fakes';
import { ServiceInvoiceConfirmationService } from '../../../src/modules/service-invoices/service-invoice-confirmation.service';
import { DomainError } from '../../../src/shared/errors/domain-error';

const CLIENT_ID = client().id;
const ISSUED = new Date('2026-10-13T00:00:00Z');

/** A draft with everything a confirmation needs. */
const readyNote = (fields: Parameters<typeof draftNote>[0] = {}) =>
  draftNote({
    issueDate: ISSUED,
    amount: new Prisma.Decimal(1500),
    number: '1287',
    clientId: CLIENT_ID,
    ...fields,
  });

describe('ServiceInvoiceConfirmationService', () => {
  let service: ServiceInvoiceConfirmationService;
  let repository: FakeServiceInvoicesRepository;
  let clients: FakeClients;
  let entries: FakeFinancialEntries;

  beforeEach(() => {
    repository = new FakeServiceInvoicesRepository();
    clients = new FakeClients();
    clients.findOne.mockImplementation(() =>
      Promise.resolve(client({ paymentTermsDays: 30 })),
    );
    entries = new FakeFinancialEntries();
    service = confirmationService(repository, clients, entries);
  });

  describe('confirm', () => {
    const confirm = (allowDuplicate?: boolean) =>
      service.confirm(USER_ID, INVOICE_ID, { allowDuplicate });

    it('confirms the note and records its income, due after the client terms', async () => {
      repository.invoice = readyNote();

      await expect(confirm()).resolves.toEqual({
        id: INVOICE_ID,
        financialEntryId: `entry-${INVOICE_ID}`,
      });
      expect(repository.invoice).toMatchObject({
        status: 'CONFIRMED',
        reviewedAt: expect.any(Date) as Date,
      });
      expect(entries.entries.get(INVOICE_ID)).toMatchObject({
        userId: USER_ID,
        number: '1287',
        amount: new Prisma.Decimal(1500),
        issueDate: ISSUED,
        dueDate: new Date('2026-11-12T00:00:00Z'),
      });
    });

    it('lists what is still missing, and changes nothing', async () => {
      repository.invoice = draftNote({ amount: new Prisma.Decimal(1500) });

      await expect(confirm()).rejects.toMatchObject({
        code: 'SERVICE_INVOICE_NOT_READY',
        kind: 'INVALID_INPUT',
        details: { missing: ['issueDate', 'clientId'] },
      });
      expect(repository.invoice?.status).toBe('DRAFT');
      expect(entries.recordServiceInvoice).not.toHaveBeenCalled();
    });

    it('does not confirm with a client that is gone or not the user’s', async () => {
      repository.invoice = readyNote();
      clients.findOne.mockRejectedValue(
        new DomainError('NOT_FOUND', 'CLIENT_NOT_FOUND', 'Client not found'),
      );

      await expect(confirm()).rejects.toMatchObject({
        code: 'CLIENT_NOT_FOUND',
      });
      expect(repository.invoice?.status).toBe('DRAFT');
    });

    describe('when a confirmed note looks like this one', () => {
      beforeEach(() => {
        repository.invoice = readyNote();
        repository.duplicate = {
          ...readyNote({ id: 'other-note', status: 'CONFIRMED' }),
          client: { name: 'Clínica Veterinária Exemplo' },
        };
      });

      it('answers it instead of confirming', async () => {
        await expect(confirm()).rejects.toMatchObject({
          code: 'SERVICE_INVOICE_POSSIBLE_DUPLICATE',
          kind: 'CONFLICT',
          details: {
            duplicateOf: { id: 'other-note', reason: 'SAME_AMOUNT_AND_DATE' },
          },
        });
        expect(repository.invoice?.status).toBe('DRAFT');
      });

      it('confirms once the user insists', async () => {
        await confirm(true);

        expect(repository.invoice?.status).toBe('CONFIRMED');
        expect(repository.duplicateQueries).toEqual([]);
      });
    });

    it.each(['CONFIRMED', 'CANCELLED'] as const)(
      'does not confirm a %s note',
      async status => {
        repository.invoice = readyNote({ status });

        await expect(confirm()).rejects.toMatchObject({
          code: 'SERVICE_INVOICE_NOT_EDITABLE',
        });
        expect(entries.recordServiceInvoice).not.toHaveBeenCalled();
      },
    );

    it("answers 404 for a note that is not the user's", async () => {
      await expect(confirm()).rejects.toMatchObject({
        code: 'SERVICE_INVOICE_NOT_FOUND',
      });
    });
  });

  describe('a confirmed note', () => {
    beforeEach(async () => {
      repository.invoice = readyNote();
      await service.confirm(USER_ID, INVOICE_ID, {});
    });

    it('takes its income entry along when edited', async () => {
      await service.update(USER_ID, INVOICE_ID, {
        amount: 1450,
        issueDate: '2026-10-20',
      });

      expect(entries.entries.get(INVOICE_ID)).toMatchObject({
        amount: new Prisma.Decimal(1450),
        issueDate: new Date('2026-10-20T00:00:00Z'),
        dueDate: new Date('2026-11-19T00:00:00Z'),
      });
    });

    it('cannot lose a required field, and stays as it was', async () => {
      await expect(
        service.update(USER_ID, INVOICE_ID, { clientId: null, number: '9' }),
      ).rejects.toMatchObject({
        code: 'SERVICE_INVOICE_NOT_READY',
        details: { missing: ['clientId'] },
      });
      expect(repository.invoice).toMatchObject({
        clientId: CLIENT_ID,
        number: '1287',
      });
    });

    it('is deleted with its income entry', async () => {
      await service.remove(USER_ID, INVOICE_ID);

      expect(repository.invoice?.deletedAt).toEqual(expect.any(Date));
      expect(entries.entries.get(INVOICE_ID)?.deletedAt).toEqual(
        expect.any(Date),
      );
    });
  });
});
