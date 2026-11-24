import { SupplierController } from '../../../src/modules/supplier/supplier.controller';
import { SupplierService } from '../../../src/modules/supplier/supplier.service';
import { describeRoutes, ID, USER } from '../testing/routes';

describeRoutes('supplier', {
  controllers: [SupplierController],
  services: [SupplierService],
  routes: [
    {
      route: 'POST /supplier',
      body: { name: 'Vet Supplies' },
      status: 201,
      calls: [SupplierService, 'create', USER.id, { name: 'Vet Supplies' }],
    },
    {
      route: 'GET /supplier?search=vet&active=false',
      calls: [
        SupplierService,
        'findAll',
        USER.id,
        { search: 'vet', active: false, page: 1, limit: 100 },
      ],
    },
    {
      route: `GET /supplier/${ID}`,
      calls: [SupplierService, 'findOne', ID, USER.id],
    },
    {
      route: `PATCH /supplier/${ID}`,
      body: { phone: '51999990000' },
      calls: [SupplierService, 'update', ID, USER.id, { phone: '51999990000' }],
    },
    {
      route: `DELETE /supplier/${ID}`,
      calls: [SupplierService, 'remove', ID, USER.id],
    },
  ],
});
