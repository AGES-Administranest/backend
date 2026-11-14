import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  client,
  confirmationService,
  draftNote,
  FakeClients,
  FakeFinancialEntries,
  FakeServiceInvoicesRepository,
  FakeStorage,
  INVOICE_ID,
  USER_ID,
} from './testing/fakes';
import { documentKey } from '../../../src/infra/storage';
import { ServiceInvoiceConfirmationService } from '../../../src/modules/service-invoices/service-invoice-confirmation.service';
import { DomainError } from '../../../src/shared/errors/domain-error';

const CLIENT_ID = client().id;
const PDF_KEY = documentKey(USER_ID, 'service-invoices', INVOICE_ID);
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
  let storage: FakeStorage;

  beforeEach(() => {
    repository = new FakeServiceInvoicesRepository();
    clients = new FakeClients();
    clients.findOne.mockImplementation(() =>
      Promise.resolve(client({ paymentTermsDays: 30 })),
    );
    entries = new FakeFinancialEntries();
    storage = new FakeStorage();
    service = confirmationService(repository, clients, entries, storage);
  });

  describe('confirm', () => {
    const confirm = (allowDuplicate?: boolean) =>
      service.confirm(USER_ID, INVOICE_ID, { allowDuplicate });

    describe('the location', () => {
      it("is filled from the taker's city and state", async () => {
        clients.findOne.mockResolvedValue(
          client({ city: 'São Paulo', state: 'SP' }),
        );
        repository.invoice = readyNote();

        await confirm();

        expect(repository.invoice?.location).toBe('São Paulo, SP');
      });

      it.each([
        { city: 'São Paulo', state: null },
        { city: null, state: 'SP' },
        { city: ' ', state: 'SP' },
      ])('stays null when the taker has only part of it (%j)', async taker => {
        clients.findOne.mockResolvedValue(client(taker));
        repository.invoice = readyNote();

        await confirm();

        expect(repository.invoice?.location).toBeNull();
      });

      it('keeps what the user typed', async () => {
        clients.findOne.mockResolvedValue(
          client({ city: 'São Paulo', state: 'SP' }),
        );
        repository.invoice = readyNote({ location: 'Campinas, SP' });

        await confirm();

        expect(repository.invoice?.location).toBe('Campinas, SP');
      });
    });

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

    const correction = {
      issueDate: '2026-10-20',
      amount: 1450,
      clientId: CLIENT_ID,
    };

    it('takes its income entry along when corrected', async () => {
      await service.update(USER_ID, INVOICE_ID, correction);

      expect(repository.invoice).toMatchObject({
        issueDate: new Date('2026-10-20T00:00:00Z'),
        amount: new Prisma.Decimal(1450),
      });
      expect(entries.entries.get(INVOICE_ID)).toMatchObject({
        amount: new Prisma.Decimal(1450),
        issueDate: new Date('2026-10-20T00:00:00Z'),
        dueDate: new Date('2026-11-19T00:00:00Z'),
      });
      expect(entries.recordServiceInvoice).toHaveBeenCalledTimes(1);
    });

    it('sets and clears the location, and leaves the number alone', async () => {
      await service.update(USER_ID, INVOICE_ID, {
        ...correction,
        number: '9999',
        location: ' Campinas, SP ',
      });
      expect(repository.invoice).toMatchObject({
        location: 'Campinas, SP',
        number: '1287',
      });

      await service.update(USER_ID, INVOICE_ID, {
        ...correction,
        location: null,
      });
      expect(repository.invoice?.location).toBeNull();
    });

    it('does not run the duplicate check again', async () => {
      repository.duplicateQueries.length = 0;

      await service.update(USER_ID, INVOICE_ID, correction);

      expect(repository.duplicateQueries).toEqual([]);
    });

    it.each(['issueDate', 'amount', 'clientId'] as const)(
      'refuses a correction without %s, and stays as it was',
      async field => {
        await expect(
          service.update(USER_ID, INVOICE_ID, {
            ...correction,
            [field]: null,
          }),
        ).rejects.toMatchObject({
          code: 'SERVICE_INVOICE_NOT_READY',
          details: { missing: [field] },
        });
        expect(repository.invoice).toMatchObject({
          clientId: CLIENT_ID,
          amount: new Prisma.Decimal(1500),
        });
      },
    );

    it("rolls the note back when the client is not the user's", async () => {
      clients.findOne.mockRejectedValue(
        new DomainError('NOT_FOUND', 'CLIENT_NOT_FOUND', 'Client not found'),
      );

      await expect(
        service.update(USER_ID, INVOICE_ID, correction),
      ).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
      expect(repository.invoice).toMatchObject({
        issueDate: ISSUED,
        amount: new Prisma.Decimal(1500),
      });
      expect(entries.entries.get(INVOICE_ID)?.amount).toEqual(
        new Prisma.Decimal(1500),
      );
    });

    it('is deleted with its income entry and its PDF', async () => {
      storage.put(PDF_KEY, {
        contentLength: 10,
        contentType: 'application/pdf',
      });

      await service.remove(USER_ID, INVOICE_ID);

      expect(repository.invoice?.deletedAt).toEqual(expect.any(Date));
      expect(entries.entries.get(INVOICE_ID)?.deletedAt).toEqual(
        expect.any(Date),
      );
      await expect(storage.headDocument(PDF_KEY)).resolves.toBeNull();
    });

    it('is deleted even when the bucket fails, leaving only an orphan', async () => {
      jest
        .spyOn(storage, 'deleteDocument')
        .mockRejectedValue(new Error('bucket down'));
      jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await expect(
        service.remove(USER_ID, INVOICE_ID),
      ).resolves.toBeUndefined();
      expect(repository.invoice?.deletedAt).toEqual(expect.any(Date));
    });

    it('keeps its PDF when the delete is refused', async () => {
      storage.put(PDF_KEY, {
        contentLength: 10,
        contentType: 'application/pdf',
      });

      await expect(
        service.remove('another-user', INVOICE_ID),
      ).rejects.toMatchObject({ code: 'SERVICE_INVOICE_NOT_FOUND' });
      await expect(storage.headDocument(PDF_KEY)).resolves.not.toBeNull();
    });
  });
});
