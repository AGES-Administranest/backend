import { StockEntryDraftService } from '../../../src/modules/stock-entry/stock-entry-draft.service';
import { StockEntryController } from '../../../src/modules/stock-entry/stock-entry.controller';
import { StockEntryService } from '../../../src/modules/stock-entry/stock-entry.service';
import { SupplierInvoicesController } from '../../../src/modules/stock-entry/supplier-invoices.controller';
import { describeRoutes, ID, USER } from '../testing/routes';

const upload = {
  filename: 'order.pdf',
  fileMimeType: 'application/pdf',
  fileHash: 'a'.repeat(64),
  fileBytesSize: 10,
};
const lines = { lines: [{ description: 'Propofol', quantity: 2 }] };

describeRoutes('stock entry', {
  controllers: [StockEntryController, SupplierInvoicesController],
  services: [StockEntryService, StockEntryDraftService],
  routes: [
    {
      route: 'GET /stock-entries',
      calls: [StockEntryDraftService, 'listDrafts', USER.id],
    },
    {
      route: `GET /stock-entries/${ID}`,
      calls: [StockEntryDraftService, 'getDraft', USER.id, ID],
    },
    {
      route: `PATCH /stock-entries/${ID}`,
      body: { invoiceNumber: null, totalAmount: 10 },
      status: 204,
      calls: [
        StockEntryDraftService,
        'updateHeader',
        USER.id,
        ID,
        { invoiceNumber: null, totalAmount: 10 },
      ],
    },
    {
      route: `PUT /stock-entries/${ID}/items`,
      body: lines,
      status: 204,
      calls: [StockEntryDraftService, 'replaceLines', USER.id, ID, lines],
    },
    {
      route: `POST /stock-entries/${ID}/confirm`,
      status: 204,
      calls: [StockEntryDraftService, 'confirm', USER.id, ID],
    },
    {
      route: `DELETE /stock-entries/${ID}`,
      status: 204,
      calls: [StockEntryDraftService, 'discard', USER.id, ID],
    },
    {
      route: `POST /stock-entries/${ID}/upload-url`,
      body: upload,
      calls: [StockEntryService, 'createUploadUrl', USER.id, ID, upload],
    },
    {
      route: `POST /stock-entries/${ID}/uploaded`,
      calls: [StockEntryService, 'confirmUpload', USER.id, ID],
    },
    {
      route: `GET /supplier/${ID}/purchase-invoices?from=2026-10-01`,
      calls: [
        StockEntryService,
        'listSupplierInvoices',
        USER.id,
        ID,
        { from: '2026-10-01', page: 1, limit: 50 },
      ],
    },
  ],
});
