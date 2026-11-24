import { ItemLotController } from '../../../src/modules/item/item-lot.controller';
import { ItemLotService } from '../../../src/modules/item/item-lot.service';
import { ItemController } from '../../../src/modules/item/item.controller';
import { ItemService } from '../../../src/modules/item/item.service';
import { describeRoutes, ID, USER } from '../testing/routes';

const item = { category: 'MEDICATION', unit: 'AMPOULE', name: 'Propofol' };
const lot = { quantity: 2, expirationDate: '2027-01-01' };

describeRoutes('item', {
  controllers: [ItemController, ItemLotController],
  services: [ItemService, ItemLotService],
  routes: [
    {
      route: 'POST /item',
      body: item,
      status: 201,
      calls: [ItemService, 'create', USER.id, item],
    },
    {
      route: 'GET /item?category=MEDICATION&active=false&page=2',
      calls: [
        ItemService,
        'findAll',
        USER.id,
        {
          category: ['MEDICATION'],
          active: false,
          sort: 'name',
          page: 2,
          limit: 20,
        },
      ],
    },
    {
      route: `GET /item/${ID}`,
      calls: [ItemService, 'findOne', ID, USER.id],
    },
    {
      route: `PATCH /item/${ID}`,
      body: { name: 'Ketamine' },
      calls: [ItemService, 'update', ID, USER.id, { name: 'Ketamine' }],
    },
    {
      route: `DELETE /item/${ID}`,
      calls: [ItemService, 'remove', ID, USER.id],
    },
    {
      route: `POST /item/${ID}/lot`,
      body: lot,
      status: 201,
      calls: [ItemLotService, 'create', ID, USER.id, lot],
    },
  ],
});
