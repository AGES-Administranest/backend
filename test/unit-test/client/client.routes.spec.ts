import { ClientController } from '../../../src/modules/client/client.controller';
import { ClientService } from '../../../src/modules/client/client.service';
import { describeRoutes, ID, USER } from '../testing/routes';

const client = { type: 'CLINIC', name: 'Clinic' };

describeRoutes('client', {
  controllers: [ClientController],
  services: [ClientService],
  routes: [
    {
      route: 'POST /client',
      body: client,
      status: 201,
      calls: [ClientService, 'create', USER.id, client],
    },
    {
      route: 'GET /client?type=CLINIC',
      calls: [ClientService, 'findAll', USER.id, { type: 'CLINIC' }],
    },
    {
      route: `GET /client/${ID}`,
      calls: [ClientService, 'findOne', ID, USER.id],
    },
    {
      route: `GET /client/${ID}/appointments?from=2026-10-01&page=2`,
      calls: [
        ClientService,
        'findAppointments',
        ID,
        USER.id,
        { from: '2026-10-01', page: 2, limit: 20 },
      ],
    },
    {
      route: `GET /client/${ID}/summary?to=2026-10-31`,
      calls: [ClientService, 'summarize', ID, USER.id, { to: '2026-10-31' }],
    },
    {
      route: `PATCH /client/${ID}`,
      body: { name: 'New name' },
      calls: [ClientService, 'update', ID, USER.id, { name: 'New name' }],
    },
    {
      route: `DELETE /client/${ID}`,
      calls: [ClientService, 'remove', ID, USER.id],
    },
  ],
});
