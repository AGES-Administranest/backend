import { randomBytes } from 'node:crypto';

import { TAX_PACKAGE_LIMITS } from './reports.constants';
import { TaxPackageService } from './tax-package.service';
import {
  DocumentStorage,
  DocumentUploads,
  PutDocumentRequest,
} from '../../infra/storage';
import { DomainError } from '../../shared/errors/domain-error';
import {
  TaxPackageDocument,
  TaxPackageTotals,
} from '../../shared/tax-package/tax-package.types';
import { ServiceInvoiceCountService } from '../service-invoices';
import { StockEntryService } from '../stock-entry';

const USER = 'user-1';
const PERIOD = { from: '2026-03-01', to: '2026-03-31' };

class FakeStorage extends DocumentStorage {
  readonly files = new Map<string, Uint8Array>();
  readonly written = new Map<string, Buffer>();
  readonly reads: string[] = [];
  failUpload: Error | null = null;

  createPresignedPost(): never {
    throw new Error('not used');
  }
  headDocument(): never {
    throw new Error('not used');
  }
  getDocument(key: string): Promise<Uint8Array | null> {
    this.reads.push(key);
    return Promise.resolve(this.files.get(key) ?? null);
  }
  createPresignedGet(request: { key: string; fileName?: string }) {
    return Promise.resolve({
      url: `https://bucket/${request.key}?name=${request.fileName ?? ''}`,
      expiresAt: 1_800_000_000_000,
    });
  }
  async putDocument({ key, body, signal }: PutDocumentRequest): Promise<void> {
    const chunks: Buffer[] = [];
    const aborted = new Promise<never>((_, reject) =>
      signal?.addEventListener('abort', () => reject(signal.reason as Error)),
    );
    aborted.catch(() => undefined);
    const read = (async () => {
      for await (const chunk of body) chunks.push(chunk as Buffer);
    })();
    await Promise.race([read, aborted]);
    if (this.failUpload) throw this.failUpload;
    this.written.set(key, Buffer.concat(chunks));
  }
}

function document(
  index: number,
  collection: TaxPackageDocument['collection'] = 'service-invoices',
): TaxPackageDocument {
  return {
    collection,
    id: `${collection}-${index}`,
    issueDate: new Date(Date.UTC(2026, 2, 1 + (index % 28))),
    counterpartName: `Clinica ${index}`,
    amount: 100 + index,
    fileName: 'a.pdf',
    mimeType: 'application/pdf',
  };
}

function setup(
  options: {
    services?: TaxPackageDocument[];
    purchases?: TaxPackageDocument[];
    serviceTotals?: Partial<TaxPackageTotals>;
    purchaseTotals?: Partial<TaxPackageTotals>;
  } = {},
) {
  const services = options.services ?? [];
  const purchases = options.purchases ?? [];
  const storage = new FakeStorage();
  for (const doc of [...services, ...purchases]) {
    storage.files.set(
      `users/${USER}/${doc.collection}/${doc.id}/original`,
      randomBytes(256),
    );
  }

  const totalsOf = (
    docs: TaxPackageDocument[],
    overrides?: Partial<TaxPackageTotals>,
  ): TaxPackageTotals => ({
    count: docs.length,
    totalAmount: docs.reduce((sum, doc) => sum + (doc.amount ?? 0), 0),
    bytesSize: docs.length * 256,
    missingFiles: 0,
    ...overrides,
  });

  const serviceInvoices = {
    summarizeTaxPackage: jest.fn(() =>
      Promise.resolve(totalsOf(services, options.serviceTotals)),
    ),
    listTaxPackageDocuments: jest.fn(() => Promise.resolve(services)),
  };
  const purchaseInvoices = {
    summarizeTaxPackage: jest.fn(() =>
      Promise.resolve(totalsOf(purchases, options.purchaseTotals)),
    ),
    listTaxPackageDocuments: jest.fn(() => Promise.resolve(purchases)),
  };

  const service = new TaxPackageService(
    serviceInvoices as unknown as ServiceInvoiceCountService,
    purchaseInvoices as unknown as StockEntryService,
    new DocumentUploads(storage),
  );
  return { service, storage, serviceInvoices, purchaseInvoices };
}

const failureOf = async (promise: Promise<unknown>): Promise<DomainError> => {
  try {
    await promise;
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('expected a failure');
};

describe('TaxPackageService.getSummary', () => {
  it('adds both kinds and keeps the split', async () => {
    const { service } = setup({
      serviceTotals: { count: 8, totalAmount: 3200.1, missingFiles: 2 },
      purchaseTotals: { count: 4, totalAmount: 1150.2, missingFiles: 1 },
    });

    await expect(service.getSummary(USER, PERIOD)).resolves.toEqual({
      documentsCount: 12,
      totalAmount: 4350.3,
      byType: {
        serviceInvoice: { count: 8, totalAmount: 3200.1, missingFiles: 2 },
        purchaseInvoice: { count: 4, totalAmount: 1150.2, missingFiles: 1 },
      },
      missingFiles: 3,
    });
  });

  it('does not let float noise into the total', async () => {
    const { service } = setup({
      serviceTotals: { count: 1, totalAmount: 0.1 },
      purchaseTotals: { count: 1, totalAmount: 0.2 },
    });

    expect((await service.getSummary(USER, PERIOD)).totalAmount).toBe(0.3);
  });

  it('answers zeros, not an error, for an empty period', async () => {
    const { service } = setup();

    await expect(service.getSummary(USER, PERIOD)).resolves.toMatchObject({
      documentsCount: 0,
      totalAmount: 0,
      missingFiles: 0,
    });
  });

  it('asks each module about the signed-in user and the period', async () => {
    const { service, serviceInvoices, purchaseInvoices } = setup();

    await service.getSummary(USER, PERIOD);

    for (const owner of [serviceInvoices, purchaseInvoices]) {
      expect(owner.summarizeTaxPackage).toHaveBeenCalledWith(
        USER,
        expect.objectContaining({ days: expect.any(Object) as object }),
      );
    }
  });

  it('rejects a period that ends before it starts', async () => {
    const { service } = setup();

    const error = await failureOf(
      service.getSummary(USER, { from: '2026-04-01', to: '2026-03-01' }),
    );
    expect(error.code).toBe('REPORT_PERIOD_INVALID');
  });
});

describe('TaxPackageService.generate', () => {
  it('zips the documents into storage and answers with a download link', async () => {
    const { service, storage } = setup({
      services: [document(1), document(2)],
      purchases: [document(3, 'purchase-invoices')],
    });

    const result = await service.generate(USER, PERIOD);

    expect(result).toMatchObject({
      documentsCount: 3,
      skipped: [],
      fileName: 'notas-fiscais_2026-03-01_2026-03-31.zip',
      expiresAt: 1_800_000_000_000,
    });
    const [key] = [...storage.written.keys()];
    expect(key).toMatch(
      new RegExp(
        `^users/${USER}/exports/tax-package/2026-03-01_2026-03-31_[0-9a-f-]{36}\\.zip$`,
      ),
    );
    expect(result.url).toContain(key);
    const zip = storage.written.get(key) as Buffer;
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    expect(zip.toString('latin1')).toContain('Compras/');
    expect(zip.toString('latin1')).toContain('NFS-e/');
  });

  it('reads each file from the key of the signed-in user', async () => {
    const { service, storage } = setup({ services: [document(1)] });

    await service.generate(USER, PERIOD);

    expect(storage.reads).toEqual([
      `users/${USER}/service-invoices/service-invoices-1/original`,
    ]);
  });

  it('answers 404 TAX_PACKAGE_EMPTY and touches no file for an empty period', async () => {
    const { service, storage, serviceInvoices } = setup({
      serviceTotals: { missingFiles: 2 },
    });

    const error = await failureOf(service.generate(USER, PERIOD));

    expect(error).toMatchObject({
      kind: 'NOT_FOUND',
      code: 'TAX_PACKAGE_EMPTY',
      details: { missingFiles: 2 },
    });
    expect(serviceInvoices.listTaxPackageDocuments).not.toHaveBeenCalled();
    expect(storage.reads).toEqual([]);
    expect(storage.written.size).toBe(0);
  });

  it('refuses a period with too many documents before reading anything', async () => {
    const { service, storage } = setup({
      serviceTotals: { count: TAX_PACKAGE_LIMITS.maxDocuments + 1 },
    });

    const error = await failureOf(service.generate(USER, PERIOD));

    expect(error).toMatchObject({
      kind: 'PAYLOAD_TOO_LARGE',
      code: 'TAX_PACKAGE_TOO_LARGE',
    });
    expect(storage.reads).toEqual([]);
  });

  it('refuses a period that adds up to too many bytes', async () => {
    const { service, storage } = setup({
      serviceTotals: {
        count: 10,
        bytesSize: TAX_PACKAGE_LIMITS.maxBytesSize + 1,
      },
    });

    const error = await failureOf(service.generate(USER, PERIOD));

    expect(error.code).toBe('TAX_PACKAGE_TOO_LARGE');
    expect(storage.reads).toEqual([]);
  });

  it('accepts exactly the limit', async () => {
    const { service } = setup({
      services: [document(1)],
      serviceTotals: {
        count: TAX_PACKAGE_LIMITS.maxDocuments,
        bytesSize: TAX_PACKAGE_LIMITS.maxBytesSize,
      },
    });

    await expect(service.generate(USER, PERIOD)).resolves.toBeDefined();
  });

  it('leaves out a file that vanished and lists it in `skipped`', async () => {
    const { service, storage } = setup({
      services: [document(1), document(2)],
    });
    storage.files.delete(
      `users/${USER}/service-invoices/service-invoices-2/original`,
    );

    const result = await service.generate(USER, PERIOD);

    expect(result.documentsCount).toBe(1);
    expect(result.skipped).toEqual([
      {
        type: 'SERVICE_INVOICE',
        id: 'service-invoices-2',
        reason: 'FILE_NOT_FOUND',
      },
    ]);
  });

  it('answers TAX_PACKAGE_EMPTY, and stores nothing, when every file vanished', async () => {
    const { service, storage } = setup({ services: [document(1)] });
    storage.files.clear();

    const error = await failureOf(service.generate(USER, PERIOD));

    expect(error.code).toBe('TAX_PACKAGE_EMPTY');
    expect(storage.written.size).toBe(0);
  });

  it('passes on a failed upload and stores nothing', async () => {
    const { service, storage } = setup({ services: [document(1)] });
    storage.failUpload = new Error('bucket unreachable');

    await expect(service.generate(USER, PERIOD)).rejects.toThrow(
      'bucket unreachable',
    );
    expect(storage.written.size).toBe(0);
  });

  it('passes on a failed read and stores nothing', async () => {
    const { service, storage } = setup({
      services: [document(1), document(2)],
    });
    jest
      .spyOn(storage, 'getDocument')
      .mockRejectedValueOnce(new Error('S3 is down'));

    await expect(service.generate(USER, PERIOD)).rejects.toThrow('S3 is down');
    expect(storage.written.size).toBe(0);
  });

  it('refuses documents that appeared after the sums, past the limit', async () => {
    const many = Array.from(
      { length: TAX_PACKAGE_LIMITS.maxDocuments + 1 },
      (_, i) => document(i),
    );
    const { service } = setup({
      services: many,
      serviceTotals: { count: 1, bytesSize: 256 },
    });

    const error = await failureOf(service.generate(USER, PERIOD));
    expect(error.code).toBe('TAX_PACKAGE_TOO_LARGE');
  });

  it('packs a large period: 500 documents', async () => {
    const services = Array.from({ length: 300 }, (_, i) => document(i));
    const purchases = Array.from({ length: 200 }, (_, i) =>
      document(i, 'purchase-invoices'),
    );
    const { service, storage } = setup({ services, purchases });

    const result = await service.generate(USER, PERIOD);

    expect(result.documentsCount).toBe(500);
    const [zip] = [...storage.written.values()];
    expect(zip?.toString('latin1').split('PK\u0003\u0004').length - 1).toBe(
      500,
    );
  }, 30_000);

  it('names two documents of the same day, client and amount apart', async () => {
    const twin = { ...document(1), id: 'twin' };
    const { service, storage } = setup({ services: [document(1), twin] });

    await service.generate(USER, PERIOD);

    const [zip] = [...storage.written.values()];
    const text = zip?.toString('latin1') ?? '';
    expect(text).toContain('Clinica1_101,00.pdf');
    expect(text).toContain('Clinica1_101,00_2.pdf');
  });
});
