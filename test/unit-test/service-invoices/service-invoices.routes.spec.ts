import { ServiceInvoiceConfirmationService } from '../../../src/modules/service-invoices/service-invoice-confirmation.service';
import { ServiceInvoiceDraftService } from '../../../src/modules/service-invoices/service-invoice-draft.service';
import { ServiceInvoiceUploadService } from '../../../src/modules/service-invoices/service-invoice-upload.service';
import { ServiceInvoicesController } from '../../../src/modules/service-invoices/service-invoices.controller';
import { describeRoutes, ID, USER } from '../testing/routes';

const upload = {
  filename: 'nfse.pdf',
  fileMimeType: 'application/pdf',
  fileHash: 'a'.repeat(64),
  fileBytesSize: 10,
};

describeRoutes('service invoices', {
  controllers: [ServiceInvoicesController],
  services: [
    ServiceInvoiceUploadService,
    ServiceInvoiceDraftService,
    ServiceInvoiceConfirmationService,
  ],
  routes: [
    {
      route:
        'GET /service-invoices?status=CONFIRMED&sort=issueDate:desc&page=1&pageSize=20',
      calls: [
        ServiceInvoiceDraftService,
        'list',
        USER.id,
        { status: 'CONFIRMED', sort: 'issueDate:desc', page: 1, pageSize: 20 },
      ],
    },
    // Not an id: it has to be declared before `:id`.
    {
      route: 'GET /service-invoices/reports?search=%20clinic%20',
      calls: [
        ServiceInvoiceDraftService,
        'listForReports',
        USER.id,
        { search: 'clinic', page: 1, limit: 50 },
      ],
    },
    {
      route: `GET /service-invoices/${ID}`,
      calls: [ServiceInvoiceDraftService, 'get', USER.id, ID],
    },
    {
      route: `PATCH /service-invoices/${ID}`,
      body: { amount: 99.9, clientId: null },
      calls: [
        ServiceInvoiceDraftService,
        'update',
        USER.id,
        ID,
        { amount: 99.9, clientId: null },
      ],
    },
    {
      route: `DELETE /service-invoices/${ID}`,
      status: 204,
      calls: [ServiceInvoiceDraftService, 'discard', USER.id, ID],
    },
    {
      route: `POST /service-invoices/${ID}/confirm`,
      body: { allowDuplicate: true },
      calls: [
        ServiceInvoiceConfirmationService,
        'confirm',
        USER.id,
        ID,
        { allowDuplicate: true },
      ],
    },
    {
      route: `GET /service-invoices/${ID}/download-url`,
      calls: [ServiceInvoiceDraftService, 'downloadFile', USER.id, ID],
    },
    {
      route: `POST /service-invoices/${ID}/upload-url`,
      body: upload,
      calls: [
        ServiceInvoiceUploadService,
        'createUploadUrl',
        USER.id,
        ID,
        upload,
      ],
    },
    {
      route: `POST /service-invoices/${ID}/uploaded`,
      calls: [ServiceInvoiceUploadService, 'confirmUpload', USER.id, ID],
    },
  ],
});
