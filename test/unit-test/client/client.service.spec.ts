import { Client, Prisma } from '@prisma/client';

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
    findByTaxId: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let appointments: {
    findCompletedByClient: jest.Mock;
    sumCompletedByClient: jest.Mock;
  };
  let trips: { totalsByClient: jest.Mock };
  let service: ClientService;

  beforeEach(() => {
    appointments = {
      findCompletedByClient: jest
        .fn()
        .mockResolvedValue({ appointments: [], total: 0 }),
      sumCompletedByClient: jest
        .fn()
        .mockResolvedValue({ count: 0, amount: new Prisma.Decimal(0) }),
    };
    trips = {
      totalsByClient: jest
        .fn()
        .mockResolvedValue({ count: 0, cost: new Prisma.Decimal(0) }),
    };
    repository = {
      findMany: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByName: jest.fn().mockResolvedValue(null),
      findByTaxId: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    service = new ClientService(
      repository as never,
      appointments as never,
      trips as never,
    );
  });

  describe('summarize', () => {
    const period = { from: '2026-11-01', to: '2026-11-30' };

    beforeEach(() => repository.findById.mockResolvedValue(client()));

    it('reads appointments by São Paulo instant and trips by calendar day', async () => {
      await service.summarize('client-1', 'user-1', period);

      expect(appointments.sumCompletedByClient).toHaveBeenCalledWith(
        'user-1',
        'client-1',
        {
          from: new Date('2026-11-01T03:00:00.000Z'),
          before: new Date('2026-12-01T03:00:00.000Z'),
        },
      );
      expect(trips.totalsByClient).toHaveBeenCalledWith('user-1', 'client-1', {
        from: new Date('2026-11-01T00:00:00.000Z'),
        to: new Date('2026-11-30T00:00:00.000Z'),
      });
    });

    it('reads everything without a period', async () => {
      await service.summarize('client-1', 'user-1', {});

      expect(appointments.sumCompletedByClient).toHaveBeenCalledWith(
        'user-1',
        'client-1',
        { from: undefined, before: undefined },
      );
      expect(trips.totalsByClient).toHaveBeenCalledWith('user-1', 'client-1', {
        from: undefined,
        to: undefined,
      });
    });

    it('sends the money as strings with cents', async () => {
      appointments.sumCompletedByClient.mockResolvedValue({
        count: 6,
        amount: new Prisma.Decimal(3420),
      });
      trips.totalsByClient.mockResolvedValue({
        count: 4,
        cost: new Prisma.Decimal('96.5'),
      });

      await expect(
        service.summarize('client-1', 'user-1', period),
      ).resolves.toEqual({
        appointmentsCount: 6,
        billedTotal: '3420.00',
        tripCost: '96.50',
        tripCount: 4,
      });
    });

    it('answers zeros for a period without anything', async () => {
      await expect(
        service.summarize('client-1', 'user-1', period),
      ).resolves.toEqual({
        appointmentsCount: 0,
        billedTotal: '0.00',
        tripCost: '0.00',
        tripCount: 0,
      });
    });

    it('refuses a period that ends before it starts', async () => {
      await expectDomainError(
        service.summarize('client-1', 'user-1', {
          from: '2026-11-30',
          to: '2026-11-01',
        }),
        'INVALID_REQUEST',
      );
      expect(appointments.sumCompletedByClient).not.toHaveBeenCalled();
    });

    it("reports someone else's client as not found, reading nothing", async () => {
      repository.findById.mockResolvedValue(null);

      await expectDomainError(
        service.summarize('client-1', 'user-2', period),
        'CLIENT_NOT_FOUND',
      );
      expect(appointments.sumCompletedByClient).not.toHaveBeenCalled();
      expect(trips.totalsByClient).not.toHaveBeenCalled();
    });
  });

  describe('findAppointments', () => {
    const query = { page: 1, limit: 10 };

    beforeEach(() => repository.findById.mockResolvedValue(client()));

    it('asks for the São Paulo days of the period, the last one included', async () => {
      await service.findAppointments('client-1', 'user-1', {
        ...query,
        from: '2026-11-01',
        to: '2026-11-30',
      });

      expect(appointments.findCompletedByClient).toHaveBeenCalledWith(
        'user-1',
        'client-1',
        {
          from: new Date('2026-11-01T03:00:00.000Z'),
          before: new Date('2026-12-01T03:00:00.000Z'),
        },
        0,
        10,
      );
    });

    it('asks for everything without a period', async () => {
      await service.findAppointments('client-1', 'user-1', query);

      expect(appointments.findCompletedByClient).toHaveBeenCalledWith(
        'user-1',
        'client-1',
        { from: undefined, before: undefined },
        0,
        10,
      );
    });

    it('accepts a period of a single day', async () => {
      await service.findAppointments('client-1', 'user-1', {
        ...query,
        from: '2026-11-01',
        to: '2026-11-01',
      });

      expect(appointments.findCompletedByClient).toHaveBeenCalled();
    });

    it('turns the page into an offset', async () => {
      await service.findAppointments('client-1', 'user-1', {
        page: 3,
        limit: 10,
      });

      expect(appointments.findCompletedByClient).toHaveBeenCalledWith(
        'user-1',
        'client-1',
        expect.anything(),
        20,
        10,
      );
    });

    it('sends amounts as strings with cents, keeping a missing one null', async () => {
      const startsAt = new Date('2026-11-03T16:00:00.000Z');
      appointments.findCompletedByClient.mockResolvedValue({
        appointments: [
          {
            id: 'appointment-1',
            startsAt,
            procedureName: 'Orquiectomia',
            patientName: 'Mel',
            amount: new Prisma.Decimal(620),
          },
          {
            id: 'appointment-2',
            startsAt,
            procedureName: null,
            patientName: null,
            amount: null,
          },
        ],
        total: 13,
      });

      await expect(
        service.findAppointments('client-1', 'user-1', query),
      ).resolves.toEqual({
        items: [
          {
            id: 'appointment-1',
            startsAt,
            procedureName: 'Orquiectomia',
            patientName: 'Mel',
            amount: '620.00',
          },
          {
            id: 'appointment-2',
            startsAt,
            procedureName: null,
            patientName: null,
            amount: null,
          },
        ],
        total: 13,
        page: 1,
        limit: 10,
      });
    });

    it('refuses a period that ends before it starts', async () => {
      await expectDomainError(
        service.findAppointments('client-1', 'user-1', {
          ...query,
          from: '2026-11-30',
          to: '2026-11-01',
        }),
        'INVALID_REQUEST',
      );
      expect(appointments.findCompletedByClient).not.toHaveBeenCalled();
    });

    it("reports someone else's client as not found, reading nothing", async () => {
      repository.findById.mockResolvedValue(null);

      await expectDomainError(
        service.findAppointments('client-1', 'user-2', query),
        'CLIENT_NOT_FOUND',
      );
      expect(repository.findById).toHaveBeenCalledWith('client-1', 'user-2');
      expect(appointments.findCompletedByClient).not.toHaveBeenCalled();
    });
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

  describe('findByTaxId', () => {
    it('finds the client holding the tax id, without leaking userId', async () => {
      repository.findByTaxId.mockResolvedValue(
        client({ taxId: '12345678000195', active: false }),
      );

      const result = await service.findByTaxId('user-1', '12345678000195');

      expect(repository.findByTaxId).toHaveBeenCalledWith(
        'user-1',
        '12345678000195',
      );
      expect(result).toMatchObject({ id: 'client-1', active: false });
      expect(result).not.toHaveProperty('userId');
    });

    it('answers null when no client holds it', async () => {
      await expect(
        service.findByTaxId('user-1', '12345678000195'),
      ).resolves.toBeNull();
    });
  });

  describe('suggestByName', () => {
    it("ranks only the user's active clients", async () => {
      repository.findMany.mockResolvedValue([
        client({ id: 'other', name: 'Clínica Santa Maria' }),
        client({ id: 'same', name: 'Clínica Exemplo' }),
      ]);

      const result = await service.suggestByName(
        'user-1',
        'CLINICA VETERINARIA EXEMPLO LTDA',
      );

      expect(repository.findMany).toHaveBeenCalledWith({
        userId: 'user-1',
        active: true,
      });
      expect(result.map(suggestion => suggestion.id)).toEqual(['same']);
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

    describe('tax id', () => {
      const withCnpj: CreateClientDto = {
        ...dto,
        taxId: '12345678000190',
        taxIdType: 'CNPJ',
      };

      it("checks the tax id against the owner's clients", async () => {
        repository.create.mockResolvedValue(client(withCnpj));

        await service.create('user-1', withCnpj);

        expect(repository.findByTaxId).toHaveBeenCalledWith(
          'user-1',
          '12345678000190',
          undefined,
        );
        expect(repository.create).toHaveBeenCalled();
      });

      it('rejects a tax id the owner already registered', async () => {
        repository.findByTaxId.mockResolvedValue(client({ id: 'client-2' }));

        await expectDomainError(
          service.create('user-1', withCnpj),
          'DUPLICATED_CLIENT_TAX_ID',
        );
        expect(repository.create).not.toHaveBeenCalled();
      });

      it.each([
        ['no tax id', {}],
        ['a null tax id', { taxId: null, taxIdType: null }],
      ])('skips the check for %s', async (_case, fields) => {
        repository.create.mockResolvedValue(client());

        await service.create('user-1', { ...dto, ...fields });

        expect(repository.findByTaxId).not.toHaveBeenCalled();
      });
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

    describe('tax id', () => {
      const newCpf = { taxId: '12345678901', taxIdType: 'CPF' as const };

      it('checks the new tax id against the other clients only', async () => {
        repository.update.mockResolvedValue(client(newCpf));

        await service.update('client-1', 'user-1', newCpf);

        expect(repository.findByTaxId).toHaveBeenCalledWith(
          'user-1',
          '12345678901',
          'client-1',
        );
      });

      it('rejects a tax id already held by another of the owner’s clients', async () => {
        repository.findByTaxId.mockResolvedValue(client({ id: 'client-2' }));

        await expectDomainError(
          service.update('client-1', 'user-1', newCpf),
          'DUPLICATED_CLIENT_TAX_ID',
        );
        expect(repository.update).not.toHaveBeenCalled();
      });

      it.each([
        ['the tax id is not being changed', { city: 'Canoas' }],
        ['the tax id is being removed', { taxId: null, taxIdType: null }],
      ])('skips the check when %s', async (_case, fields) => {
        repository.update.mockResolvedValue(client());

        await service.update('client-1', 'user-1', fields);

        expect(repository.findByTaxId).not.toHaveBeenCalled();
      });
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
