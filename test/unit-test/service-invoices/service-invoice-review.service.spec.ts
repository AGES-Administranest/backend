import { Prisma } from '@prisma/client';

import {
  client,
  draftNote,
  FakeClients,
  FakeServiceInvoicesRepository,
  reviewService,
  USER_ID,
} from './testing/fakes';
import { ServiceInvoiceReviewService } from '../../../src/modules/service-invoices/service-invoice-review.service';
import { DuplicateNote } from '../../../src/modules/service-invoices/service-invoices.repository';

const READ_TAKER = {
  status: 'success',
  taker: { name: 'CLINICA VETERINARIA EXEMPLO LTDA', taxId: '12345678000195' },
};

const ISSUED = new Date('2026-10-13T00:00:00Z');

function confirmedNote(fields: Partial<DuplicateNote> = {}): DuplicateNote {
  return {
    ...draftNote({
      id: 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b',
      status: 'CONFIRMED',
      number: '1201',
      issueDate: ISSUED,
      amount: new Prisma.Decimal(1500),
    }),
    client: { name: 'Clínica Veterinária Exemplo' },
    ...fields,
  };
}

describe('ServiceInvoiceReviewService', () => {
  let service: ServiceInvoiceReviewService;
  let repository: FakeServiceInvoicesRepository;
  let clients: FakeClients;

  beforeEach(() => {
    repository = new FakeServiceInvoicesRepository();
    clients = new FakeClients();
    service = reviewService(repository, clients);
  });

  describe('taker', () => {
    const readNote = () =>
      draftNote({ takerTaxId: '12345678000195', rawExtraction: READ_TAKER });

    it('links the client holding the tax id, without suggesting others', async () => {
      clients.byTaxId = client();
      clients.byName = [client({ id: 'other' })];

      const review = await service.reviewOf(USER_ID, readNote());

      expect(review.clientMatch).toEqual({
        id: client().id,
        name: 'Clínica Veterinária Exemplo',
        taxId: '12345678000195',
      });
      expect(review).not.toHaveProperty('clientSuggestions');
      expect(clients.suggestByName).not.toHaveBeenCalled();
    });

    it('suggests by the name read when no client holds the tax id', async () => {
      clients.byName = [
        client({ id: 'same', name: 'Clínica Exemplo', taxId: null }),
      ];

      const review = await service.reviewOf(USER_ID, readNote());

      expect(review).not.toHaveProperty('clientMatch');
      expect(review.clientSuggestions).toEqual([
        { id: 'same', name: 'Clínica Exemplo' },
      ]);
      expect(clients.suggestByName).toHaveBeenCalledWith(
        USER_ID,
        'CLINICA VETERINARIA EXEMPLO LTDA',
      );
    });

    it('says nothing when no client looks like the taker', async () => {
      const review = await service.reviewOf(USER_ID, readNote());

      expect(review).not.toHaveProperty('clientMatch');
      expect(review).not.toHaveProperty('clientSuggestions');
    });

    it('leaves the client the user picked alone', async () => {
      clients.byTaxId = client({ id: 'other' });

      const review = await service.reviewOf(
        USER_ID,
        draftNote({ ...readNote(), clientId: client().id }),
      );

      expect(review.clientId).toBe(client().id);
      expect(review).not.toHaveProperty('clientMatch');
      expect(clients.findByTaxId).not.toHaveBeenCalled();
    });
  });

  describe('duplicate', () => {
    it('points to a confirmed note with the same amount and date', async () => {
      repository.duplicate = confirmedNote();

      const review = await service.reviewOf(
        USER_ID,
        draftNote({ issueDate: ISSUED, amount: new Prisma.Decimal(1500) }),
      );

      expect(review.duplicateOf).toEqual({
        id: confirmedNote().id,
        number: '1201',
        issueDate: '2026-10-13',
        amount: 1500,
        clientName: 'Clínica Veterinária Exemplo',
        reason: 'SAME_AMOUNT_AND_DATE',
      });
    });

    it('points to a confirmed note with the same number and taker', async () => {
      repository.duplicate = confirmedNote({ number: '1287' });

      const review = await service.reviewOf(
        USER_ID,
        draftNote({
          number: '1287',
          takerTaxId: '12345678000195',
          issueDate: new Date('2026-10-14T00:00:00Z'),
          amount: new Prisma.Decimal(1500),
        }),
      );

      expect(review.duplicateOf).toMatchObject({
        reason: 'SAME_NUMBER_AND_TAKER',
      });
    });

    it('does not look for one while the note has nothing to compare', async () => {
      repository.duplicate = confirmedNote();

      const review = await service.reviewOf(
        USER_ID,
        draftNote({ issueDate: ISSUED, number: '1287' }),
      );

      expect(review).not.toHaveProperty('duplicateOf');
      expect(repository.duplicateQueries).toEqual([]);
    });
  });
});
