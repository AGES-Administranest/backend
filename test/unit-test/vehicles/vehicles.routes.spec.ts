import { VehiclesController } from '../../../src/modules/vehicles/vehicles.controller';
import { VehiclesService } from '../../../src/modules/vehicles/vehicles.service';
import { describeRoutes, ID, USER } from '../testing/routes';

const vehicle = {
  brand: 'Fiat',
  model: 'Uno',
  fuelType: 'GASOLINE',
  avgConsumptionKmL: 12.5,
  fuelPrice: 6.199,
};

describeRoutes('vehicles', {
  controllers: [VehiclesController],
  services: [VehiclesService],
  routes: [
    {
      route: 'POST /vehicles',
      body: vehicle,
      status: 201,
      calls: [VehiclesService, 'create', USER.id, vehicle],
    },
    {
      route: 'GET /vehicles',
      calls: [
        VehiclesService,
        'findAll',
        USER.id,
        expect.any(Object) as unknown,
      ],
    },
    {
      route: `GET /vehicles/${ID}`,
      calls: [VehiclesService, 'findOne', ID, USER.id],
    },
    {
      route: `PATCH /vehicles/${ID}`,
      body: { fuelPrice: 5.5 },
      calls: [VehiclesService, 'update', ID, USER.id, { fuelPrice: 5.5 }],
    },
    {
      route: `DELETE /vehicles/${ID}`,
      calls: [VehiclesService, 'remove', ID, USER.id],
    },
  ],
});
