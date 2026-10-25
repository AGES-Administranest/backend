import {
  DocumentBytes,
  ExtractionService,
  PurchaseOrderResult,
} from '../../../src/modules/extraction';
import { PurchaseOrderExtractor } from '../../../src/modules/extraction/purchase-order/purchase-order-extractor';

const PDF: DocumentBytes = {
  buffer: new TextEncoder().encode('%PDF-1.7'),
  mimeType: 'application/pdf',
};

const READ: PurchaseOrderResult = {
  status: 'success',
  invoiceNumber: '4521',
  items: [],
};

class FakePurchaseOrderExtractor extends PurchaseOrderExtractor {
  answer: () => Promise<PurchaseOrderResult> = () => Promise.resolve(READ);

  override extract() {
    return this.answer();
  }
}

describe('ExtractionService', () => {
  let purchaseOrder: FakePurchaseOrderExtractor;
  let service: ExtractionService;

  beforeEach(() => {
    purchaseOrder = new FakePurchaseOrderExtractor();
    service = new ExtractionService(purchaseOrder);
  });

  it('reads a purchase order with its own strategy', async () => {
    await expect(service.extract('purchase-order', PDF)).resolves.toEqual(READ);
  });

  it('answers a timeout in the shape of the document kind', async () => {
    jest.useFakeTimers();
    try {
      purchaseOrder.answer = () => new Promise(() => {});

      const reading = service.extract('purchase-order', PDF);
      await jest.advanceTimersByTimeAsync(purchaseOrder.settings.timeoutMs);

      await expect(reading).resolves.toEqual({
        status: 'failed',
        failureReason: 'timeout',
        items: [],
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not time out a reading that finishes in time', async () => {
    jest.useFakeTimers();
    try {
      purchaseOrder.answer = () =>
        new Promise(resolve => setTimeout(() => resolve(READ), 1000));

      const reading = service.extract('purchase-order', PDF);
      await jest.advanceTimersByTimeAsync(purchaseOrder.settings.timeoutMs);

      await expect(reading).resolves.toEqual(READ);
    } finally {
      jest.useRealTimers();
    }
  });
});
