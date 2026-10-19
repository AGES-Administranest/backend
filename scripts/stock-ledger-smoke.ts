/**
 * Hands-on walkthrough of the two ledger behaviours that have no HTTP route:
 * the US10 correction reversal (which needs `allowNegativeBalance`) and the
 * batch write. Everything else is reachable with curl — see the manual test
 * guide.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/stock-ledger-smoke.ts
 *
 * It creates its own throwaway user and items, prints what happened at each
 * step, and deletes everything it created on the way out. It talks to the
 * service directly — no Nest module graph, so it needs DATABASE_URL and
 * nothing else (no Cognito, no MiniStack).
 */
import { StockMovementSource, StockMovementType } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../src/infra/prisma/prisma.service';
import { StockMovementsRepository } from '../src/modules/stock-movements/stock-movements.repository';
import { StockMovementsService } from '../src/modules/stock-movements/stock-movements.service';

const prisma = new PrismaService();
const service = new StockMovementsService(new StockMovementsRepository(prisma));

const step = (title: string) => console.log(`\n\x1b[1m== ${title}\x1b[0m`);
const show = (label: string, value: unknown) =>
  console.log(`   ${label.padEnd(28)} ${String(value)}`);

/** Reads the balance back from the ledger, not from the cached column. */
async function ledgerBalance(userId: string, itemId: string): Promise<number> {
  const movements = await prisma.stockMovement.findMany({
    where: { userId, itemId, deletedAt: null },
  });
  return movements.reduce(
    (total, movement) =>
      movement.type === StockMovementType.INBOUND
        ? total + movement.quantity.toNumber()
        : total - movement.quantity.toNumber(),
    0,
  );
}

async function report(userId: string, itemId: string, label: string) {
  const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
  const fromLedger = await ledgerBalance(userId, itemId);
  const cached = item.currentQuantity.toNumber();
  show(`${label} — cache`, cached);
  show(`${label} — soma do histórico`, fromLedger);
  show(`${label} — needsAdjustment`, item.needsAdjustment);
  if (cached !== fromLedger) {
    throw new Error(`DIVERGÊNCIA: cache ${cached} != histórico ${fromLedger}`);
  }
}

async function main() {
  const user = await prisma.user.create({
    data: {
      cognitoSub: `smoke-${randomUUID()}`,
      email: `smoke-${randomUUID()}@example.local`,
      name: 'Smoke Test',
    },
  });
  const userId = user.id;

  const makeItem = async (name: string) =>
    (
      await prisma.item.create({
        data: { userId, name, category: 'MEDICATION', unit: 'AMPOULE' },
      })
    ).id;

  const itemA = await makeItem('Propofol (smoke)');
  const itemB = await makeItem('Midazolam (smoke)');

  try {
    step('1. Estorno de correção autorizado derruba o saldo abaixo de zero');
    const reversal = await service.record(
      userId,
      {
        itemId: itemA,
        type: StockMovementType.OUTBOUND,
        source: StockMovementSource.CORRECTION_REVERSAL,
        quantity: 3,
        unitCost: 10,
        occurredAt: new Date(),
      },
      { allowNegativeBalance: true },
    );
    show('saldo', reversal.balance.toString());
    show('alerta needsAdjustment', reversal.needsAdjustment);
    await report(userId, itemA, 'item A');

    step('2. Saída comum no vermelho é bloqueada (nada a dar baixa)');
    await service
      .registerAdjustment(userId, {
        itemId: itemA,
        quantity: 1,
        reason: 'LOSS',
      })
      .then(() => {
        throw new Error('deveria ter sido bloqueada');
      })
      .catch((error: { code?: string; details?: unknown }) => {
        if (error.code !== 'INSUFFICIENT_STOCK') throw error;
        show('code', error.code);
        show('details', JSON.stringify(error.details));
      });

    step('3. Contagem física fecha o laço — grava a diferença, não edita nada');
    const counted = await service.registerCount(userId, {
      itemId: itemA,
      countedQuantity: 4,
    });
    show('direção do movimento', counted.movement.type);
    show('quantidade gravada', counted.movement.quantity);
    show('saldo final', counted.balance);
    show('needsAdjustment', counted.needsAdjustment);
    await report(userId, itemA, 'item A');

    step('4. O histórico preserva o rastro inteiro (append-only)');
    for (const movement of await prisma.stockMovement.findMany({
      where: { userId, itemId: itemA },
      orderBy: { createdAt: 'asc' },
    })) {
      console.log(
        `   ${movement.type.padEnd(8)} ${movement.quantity.toString().padStart(6)}  ${movement.source}`,
      );
    }

    step('5. Lote: tudo grava ou nada grava');
    await service.recordBatch(userId, [
      {
        itemId: itemA,
        type: StockMovementType.INBOUND,
        source: StockMovementSource.MANUAL_PURCHASE,
        quantity: 10,
        unitCost: 10,
        occurredAt: new Date(),
      },
      {
        itemId: itemB,
        type: StockMovementType.INBOUND,
        source: StockMovementSource.MANUAL_PURCHASE,
        quantity: 5,
        unitCost: 8,
        occurredAt: new Date(),
      },
    ]);
    await report(userId, itemA, 'item A após lote ok');
    await report(userId, itemB, 'item B após lote ok');

    step('6. Lote em que a última linha não cabe: as anteriores voltam atrás');
    await service
      .recordBatch(userId, [
        {
          itemId: itemA,
          type: StockMovementType.OUTBOUND,
          source: StockMovementSource.MANUAL_ADJUSTMENT,
          adjustmentReason: 'LOSS',
          quantity: 2,
          unitCost: 10,
          occurredAt: new Date(),
        },
        {
          itemId: itemB,
          type: StockMovementType.OUTBOUND,
          source: StockMovementSource.MANUAL_ADJUSTMENT,
          adjustmentReason: 'LOSS',
          quantity: 999,
          unitCost: 8,
          occurredAt: new Date(),
        },
      ])
      .then(() => {
        throw new Error('o lote deveria ter sido recusado');
      })
      .catch((error: { code?: string }) => {
        if (error.code !== 'INSUFFICIENT_STOCK') throw error;
        show('lote recusado com', error.code);
      });
    // Se o item A tivesse perdido 2, a baixa da primeira linha teria vazado.
    await report(userId, itemA, 'item A após lote recusado');
    await report(userId, itemB, 'item B após lote recusado');

    step('7. Vinte baixas simultâneas no mesmo item: nenhuma se perde');
    await Promise.all(
      Array.from({ length: 20 }, () =>
        service.record(userId, {
          itemId: itemA,
          type: StockMovementType.OUTBOUND,
          source: StockMovementSource.MANUAL_ADJUSTMENT,
          adjustmentReason: 'BREAKAGE',
          quantity: 0.5,
          unitCost: 10,
          occurredAt: new Date(),
        }),
      ),
    );
    show('esperado', '14 - (20 x 0.5) = 4');
    await report(userId, itemA, 'item A');

    console.log('\n\x1b[32mTudo consistente.\x1b[0m\n');
  } finally {
    await prisma.stockMovement.deleteMany({ where: { userId } });
    await prisma.item.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('\n\x1b[31mFALHOU:\x1b[0m', error);
  process.exitCode = 1;
});
