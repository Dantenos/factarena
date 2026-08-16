const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { LedgerService } = require('../dist/ledger/ledger.service');

const prisma = new PrismaClient();
const ledger = new LedgerService(prisma);
const userIds = [];

async function inTransaction(callback) {
  return prisma.$transaction(callback, { isolationLevel: 'Serializable' });
}

async function main() {
  try {
    const suffix = randomUUID();
  const first = await prisma.user.create({ data: { email: `ledger-${suffix}-1@example.test` } });
  const second = await prisma.user.create({ data: { email: `ledger-${suffix}-2@example.test` } });
  const third = await prisma.user.create({ data: { email: `ledger-${suffix}-3@example.test` } });
  userIds.push(first.id, second.id, third.id);

  const simultaneousBets = await Promise.allSettled([
    inTransaction((tx) => ledger.debitForBet(tx, first.id, 70, `bet:${suffix}:1`)),
    inTransaction((tx) => ledger.debitForBet(tx, first.id, 70, `bet:${suffix}:2`)),
  ]);
  assert.equal(simultaneousBets.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(simultaneousBets.filter((result) => result.status === 'rejected').length, 1);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: first.id } })).virtualBalance, 930);

  await inTransaction((tx) => ledger.refundBet(tx, first.id, 70, `refund:${suffix}:1`));
  await inTransaction((tx) => ledger.refundBet(tx, first.id, 70, `refund:${suffix}:1`));
  await inTransaction((tx) => ledger.creditPayout(tx, first.id, 40, `payout:${suffix}:1`));
  await inTransaction((tx) => ledger.creditPayout(tx, first.id, 40, `payout:${suffix}:1`));

  const firstHistory = await prisma.transaction.findMany({ where: { userId: first.id }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(firstHistory.map((entry) => entry.amount), [-70, 70, 40]);
  assert.deepEqual(firstHistory.map((entry) => entry.balanceAfter), [930, 1000, 1040]);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: first.id } })).virtualBalance, 1040);

  const potBefore = (await prisma.user.findMany({ where: { id: { in: [second.id, third.id] } }, select: { id: true, virtualBalance: true } }))
    .reduce((sum, user) => sum + user.virtualBalance, 0);
  await inTransaction((tx) => ledger.debitForBet(tx, second.id, 20, `bet:${suffix}:3`));
  await inTransaction((tx) => ledger.debitForBet(tx, third.id, 40, `bet:${suffix}:4`));
  await inTransaction((tx) => ledger.creditPayout(tx, second.id, 60, `payout:${suffix}:pot`));
  const potAfter = (await prisma.user.findMany({ where: { id: { in: [second.id, third.id] } }, select: { id: true, virtualBalance: true } }))
    .reduce((sum, user) => sum + user.virtualBalance, 0);
  assert.equal(potAfter, potBefore);

    console.log('Ledger integration checks passed.');
  } finally {
    await prisma.transaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
