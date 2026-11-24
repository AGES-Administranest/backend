import { AccountDeletionRepository } from '../../../src/modules/account-deletion/account-deletion.repository';

const USER_ID = 'user-1';
const AUDIT = { cognitoSubHash: 'hash-1', retentionBasis: 'NONE' };

// Children first: no foreign key cascades, so each table has to be emptied
// before the ones it points at.
const OWNED_TABLES = [
  'financialEntry',
  'stockMovement',
  'purchaseInvoiceLine',
  'itemLot',
  'purchaseInvoice',
  'serviceInvoice',
  'purchaseOrder',
  'trip',
  'appointment',
  'vehicle',
  'equipment',
  'item',
  'supplier',
  'client',
  'financialCategory',
  'report',
  'pricingSettings',
  'hourlyRateSnapshot',
] as const;

describe('AccountDeletionRepository', () => {
  let order: string[];
  let tx: Record<string, Record<string, jest.Mock>>;
  let prisma: {
    user: { findUnique: jest.Mock };
    accountDeletion: { findUnique: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let repository: AccountDeletionRepository;

  beforeEach(() => {
    order = [];
    const step = (name: string, answer: unknown) =>
      jest.fn().mockImplementation(() => {
        order.push(name);
        return Promise.resolve(answer);
      });

    tx = {
      ...Object.fromEntries(
        OWNED_TABLES.map(name => [
          name,
          { deleteMany: step(name, { count: 1 }) },
        ]),
      ),
      user: { delete: step('user', {}) },
      accountDeletion: { upsert: step('audit', { userId: USER_ID }) },
    };
    prisma = {
      user: { findUnique: jest.fn() },
      accountDeletion: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest
        .fn()
        .mockImplementation((work: (client: unknown) => unknown) => work(tx)),
    };
    repository = new AccountDeletionRepository(prisma as never);
  });

  it('resolves the local id from the Cognito sub', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: USER_ID });

    await expect(repository.findUserIdByCognitoSub('sub')).resolves.toBe(
      USER_ID,
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { cognitoSub: 'sub' },
      select: { id: true },
    });
  });

  it('answers null when the sub has no account', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(repository.findUserIdByCognitoSub('sub')).resolves.toBeNull();
  });

  it('finds the audit by the hash of the sub', async () => {
    prisma.accountDeletion.findUnique.mockResolvedValue({ userId: USER_ID });

    await repository.findByCognitoSubHash('hash-1');

    expect(prisma.accountDeletion.findUnique).toHaveBeenCalledWith({
      where: { cognitoSubHash: 'hash-1' },
    });
  });

  it('empties every owned table, then the user, then writes the audit', async () => {
    await expect(repository.purge(USER_ID, AUDIT)).resolves.toEqual({
      userId: USER_ID,
    });

    expect(order).toEqual([...OWNED_TABLES, 'user', 'audit']);
  });

  it.each(OWNED_TABLES)(
    'only deletes the rows of the user from %s',
    async name => {
      await repository.purge(USER_ID, AUDIT);

      const inherited: Record<string, unknown> = {
        purchaseInvoiceLine: { purchaseInvoice: { userId: USER_ID } },
        itemLot: { item: { userId: USER_ID } },
      };
      expect(tx[name].deleteMany).toHaveBeenCalledTimes(1);
      expect(tx[name].deleteMany).toHaveBeenCalledWith({
        where: inherited[name] ?? { userId: USER_ID },
      });
    },
  );

  it('reopens the pending steps when the same sub is deleted again', async () => {
    await repository.purge(USER_ID, AUDIT);

    expect(tx.accountDeletion.upsert).toHaveBeenCalledWith({
      where: { cognitoSubHash: 'hash-1' },
      create: { userId: USER_ID, ...AUDIT },
      update: {
        userId: USER_ID,
        retentionBasis: 'NONE',
        deletedAt: expect.any(Date) as Date,
        storagePurgedAt: null,
        identityRemovedAt: null,
      },
    });
  });

  it('writes no audit when the user row is already gone', async () => {
    tx.user.delete.mockRejectedValue(new Error('gone'));

    await expect(repository.purge(USER_ID, AUDIT)).rejects.toThrow('gone');
    expect(tx.accountDeletion.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['markStoragePurged', 'storagePurgedAt'],
    ['markIdentityRemoved', 'identityRemovedAt'],
  ] as const)('%s stamps %s', async (method, column) => {
    await repository[method](USER_ID);

    expect(prisma.accountDeletion.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { [column]: expect.any(Date) as Date },
    });
  });
});
