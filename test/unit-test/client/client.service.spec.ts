import { Client } from '@prisma/client';

import { RecordNotFoundError } from '../../../src/infra/prisma/prisma-errors';
import { ClientService } from '../../../src/modules/client/client.service';
import { CreateClientDto } from '../../../src/modules/client/dto/create-client.dto';
import { DomainError } from '../../../src/shared/errors/domain-error';

const client = (overrides: Partial<Client> = {}): Client => ({
  id: 'client-1',
  userId: 'user-1',
  type: 'CLINIC',
  name: 'Hospital Veterinário Centro',
  taxId: null,
  taxIdType: null,
  contactName: null,
  email: null,
  phone: null,
  addressLine: null,
  city: null,
  state: null,
  serviceDays: [],
  paymentTermsDays: null,
  preferredPaymentMethod: null,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

const expectDomainError = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
};

describe('ClientService', () => {
  let repository: {
    findMany: jest.Mock;
    findById: jest.Mock;
    findByName: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let service: ClientService;

  beforeEach(() => {
    repository = {
      findMany: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByName: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    service = new ClientService(repository as never);
  });

  describe('findAll', () => {
    it("lists the user's clients without leaking userId", async () => {
      repository.findMany.mockResolvedValue([client()]);

      const result = await service.findAll('user-1', {});

      expect(repository.findMany).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('userId');
      expect(result[0]).not.toHaveProperty('deletedAt');
    });

    it('filters by type when one is given', async () => {
      await service.findAll('user-1', { type: 'INDIVIDUAL' });

      expect(repository.findMany).toHaveBeenCalledWith({
        userId: 'user-1',
        type: 'INDIVIDUAL',
      });
    });
  });

  describe('findOne', () => {
    it('returns the client scoped to the owner', async () => {
      repository.findById.mockResolvedValue(client());

      const result = await service.findOne('client-1', 'user-1');

      expect(repository.findById).toHaveBeenCalledWith('client-1', 'user-1');
      expect(result.id).toBe('client-1');
    });

    it('reports a missing, deleted or foreign client as CLIENT_NOT_FOUND', async () => {
      repository.findById.mockResolvedValue(null);

      await expectDomainError(
        service.findOne('client-1', 'user-1'),
        'CLIENT_NOT_FOUND',
      );
    });
  });

  describe('create', () => {
    const dto: CreateClientDto = { type: 'CLINIC', name: 'Clínica Nova' };

    it('creates the client for the token owner', async () => {
      repository.create.mockResolvedValue(client({ name: 'Clínica Nova' }));

      const result = await service.create('user-1', dto);

      expect(repository.create).toHaveBeenCalledWith({
        ...dto,
        userId: 'user-1',
      });
      expect(result).not.toHaveProperty('userId');
    });

    it('rejects a duplicated name', async () => {
      repository.findByName.mockResolvedValue(client());

      await expectDomainError(
        service.create('user-1', dto),
        'DUPLICATED_CLIENT_NAME',
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('checks the new name against the other clients only', async () => {
      repository.update.mockResolvedValue(client({ name: 'Renomeada' }));

      await service.update('client-1', 'user-1', { name: 'Renomeada' });

      expect(repository.findByName).toHaveBeenCalledWith(
        'user-1',
        'Renomeada',
        'client-1',
      );
    });

    it('rejects a name already used by another client', async () => {
      repository.findByName.mockResolvedValue(client({ id: 'client-2' }));

      await expectDomainError(
        service.update('client-1', 'user-1', { name: 'Repetida' }),
        'DUPLICATED_CLIENT_NAME',
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('skips the name check when the name is not being changed', async () => {
      repository.update.mockResolvedValue(client());

      await service.update('client-1', 'user-1', { city: 'Canoas' });

      expect(repository.findByName).not.toHaveBeenCalled();
    });

    it('reports a missing, deleted or foreign client as CLIENT_NOT_FOUND', async () => {
      repository.update.mockResolvedValue(null);

      await expectDomainError(
        service.update('client-1', 'user-1', { city: 'Canoas' }),
        'CLIENT_NOT_FOUND',
      );
    });

    it('translates a row that vanished mid-update into CLIENT_NOT_FOUND', async () => {
      repository.update.mockRejectedValue(new RecordNotFoundError());

      await expectDomainError(
        service.update('client-1', 'user-1', { city: 'Canoas' }),
        'CLIENT_NOT_FOUND',
      );
    });
  });

  describe('remove', () => {
    it('returns the id and name of the deleted client', async () => {
      repository.delete.mockResolvedValue(client());

      const result = await service.remove('client-1', 'user-1');

      expect(repository.delete).toHaveBeenCalledWith('client-1', 'user-1');
      expect(result).toEqual({
        id: 'client-1',
        name: 'Hospital Veterinário Centro',
      });
    });

    it('reports a missing, deleted or foreign client as CLIENT_NOT_FOUND', async () => {
      repository.delete.mockResolvedValue(null);

      await expectDomainError(
        service.remove('client-1', 'user-1'),
        'CLIENT_NOT_FOUND',
      );
    });

    it('translates a row that vanished mid-delete into CLIENT_NOT_FOUND', async () => {
      repository.delete.mockRejectedValue(new RecordNotFoundError());

      await expectDomainError(
        service.remove('client-1', 'user-1'),
        'CLIENT_NOT_FOUND',
      );
    });
  });
});
