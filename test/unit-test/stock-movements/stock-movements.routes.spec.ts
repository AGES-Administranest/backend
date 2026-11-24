import { StockMovementsController } from '../../../src/modules/stock-movements/stock-movements.controller';
import { StockMovementsService } from '../../../src/modules/stock-movements/stock-movements.service';
import { describeRoutes, ID, OTHER_ID, USER } from '../testing/routes';

const SINCE = '2026-10-01T00:00:00.000Z';
const adjustment = { itemId: OTHER_ID, quantity: 1, reason: 'LOSS' };
const purchase = {
  itemId: OTHER_ID,
  quantity: 1,
  unitValue: 9.9,
  date: '2026-10-10',
};
const count = { itemId: OTHER_ID, countedQuantity: 0 };
const push = {
  movements: [
    {
      id: ID,
      itemId: OTHER_ID,
      type: 'OUTBOUND',
      source: 'APPOINTMENT',
      quantity: 1,
      unitCost: 2,
      occurredAt: SINCE,
    },
  ],
};

describeRoutes('stock-movement', {
  controllers: [StockMovementsController],
  services: [StockMovementsService],
  routes: [
    {
      route: 'GET /stock-movement?type=INBOUND&source=MANUAL_PURCHASE&page=2',
      calls: [
        StockMovementsService,
        'findHistory',
        USER.id,
        { type: 'INBOUND', source: ['MANUAL_PURCHASE'], page: 2, limit: 50 },
      ],
    },
    {
      route:
        'GET /stock-movement/summary?periodStart=2026-10-01&periodEnd=2026-10-31',
      calls: [
        StockMovementsService,
        'buildSummary',
        USER.id,
        { periodStart: '2026-10-01', periodEnd: '2026-10-31' },
      ],
    },
    {
      route: `GET /stock-movement/sync?since=${SINCE}`,
      calls: [StockMovementsService, 'syncPull', USER.id, { since: SINCE }],
    },
    {
      route: 'POST /stock-movement/sync',
      body: push,
      status: 201,
      calls: [StockMovementsService, 'syncPush', USER.id, push],
    },
    {
      route: 'POST /stock-movement/adjustment',
      body: adjustment,
      status: 201,
      calls: [StockMovementsService, 'registerAdjustment', USER.id, adjustment],
    },
    {
      route: 'POST /stock-movement/purchase',
      body: purchase,
      status: 201,
      calls: [StockMovementsService, 'registerPurchase', USER.id, purchase],
    },
    {
      route: 'POST /stock-movement/count',
      body: count,
      status: 201,
      calls: [StockMovementsService, 'registerCount', USER.id, count],
    },
    {
      route: `POST /stock-movement/reconcile/${ID}`,
      calls: [StockMovementsService, 'reconcileItemBalance', USER.id, ID],
    },
  ],
});
