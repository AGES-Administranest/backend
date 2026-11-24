import { EquipmentController } from '../../../src/modules/equipment/equipment.controller';
import { EquipmentService } from '../../../src/modules/equipment/equipment.service';
import { describeRoutes, ID, USER } from '../testing/routes';

const equipment = {
  name: 'Monitor',
  purchaseValue: 1000,
  acquisitionDate: '2026-01-10',
};

describeRoutes('equipment', {
  controllers: [EquipmentController],
  services: [EquipmentService],
  routes: [
    {
      route: 'POST /equipment',
      body: equipment,
      status: 201,
      calls: [EquipmentService, 'create', USER.id, equipment],
    },
    {
      route: 'GET /equipment?active=false',
      calls: [EquipmentService, 'findAll', USER.id, { active: false }],
    },
    // Not an id: it has to be declared before `:id`.
    {
      route: 'GET /equipment/summary',
      calls: [EquipmentService, 'summary', USER.id],
    },
    {
      route: `GET /equipment/${ID}`,
      calls: [EquipmentService, 'findOne', ID, USER.id],
    },
    {
      route: `PATCH /equipment/${ID}`,
      body: { salvageValue: 10 },
      calls: [EquipmentService, 'update', ID, USER.id, { salvageValue: 10 }],
    },
    {
      route: `DELETE /equipment/${ID}`,
      calls: [EquipmentService, 'remove', ID, USER.id],
    },
  ],
});
