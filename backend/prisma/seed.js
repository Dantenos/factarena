const { PrismaClient, ClaimTruthLabel } = require('@prisma/client');
const crypto = require('node:crypto');
// Import manquant : la ligne `bcrypt.hash(...)` plus bas plantait sur un
// « ReferenceError: bcrypt is not defined », ce qui rendait tout le seed
// inutilisable. Le paquet installé est bcryptjs (cf. package.json), qui expose
// la même API que bcrypt.
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Fixed identifiers make the seed idempotent and make the demo API easy to
// exercise from curl/Postman without looking up new identifiers each time.
const ids = {
  admin: 'c111111111111111111111111',
  host: 'c222222222222222222222222',
  player: 'c333333333333333333333333',
  viewer: 'c444444444444444444444444',
  waitingRoom: 'c555555555555555555555555',
  historyRoom: 'c666666666666666666666666',
  historyRound: 'c777777777777777777777777',
  roundClaim1: 'c888888888888888888888888',
  roundClaim2: 'c999999999999999999999999',
  roundClaim3: 'caaaaaaaaaaaaaaaaaaaaaaaa',
  predictionHost: 'cbbbbbbbbbbbbbbbbbbbbbbbb',
  predictionPlayer: 'ccccccccccccccccccccccccc',
  transactionHostBet: 'cdddddddddddddddddddddddd',
  transactionHostPayout: 'ceeeeeeeeeeeeeeeeeeeeeeee',
  transactionPlayerBet: 'cffffffffffffffffffffffff',
  friendship: 'cgggggggggggggggggggggggg',
  message1: 'chhhhhhhhhhhhhhhhhhhhhhhh',
};

const legacyDemoClaims = [
  { id: 'caaaaaaaaaaaaaaaaaaaaaaaa', text: 'La première photographie permanente a été réalisée au XIXe siècle.', truthLabel: ClaimTruthLabel.TRUE, category: 'history', sourceUrl: 'https://www.britannica.com/technology/photography' },
  { id: 'cbbbbbbbbbbbbbbbbbbbbbbbb', text: 'La Grande Muraille de Chine est visible à l’œil nu depuis la Lune.', truthLabel: ClaimTruthLabel.FALSE, category: 'science', sourceUrl: 'https://www.nasa.gov/general/can-you-see-the-great-wall-of-china-from-space/' },
  { id: 'ccccccccccccccccccccccccc', text: 'L’eau bout à 100 degrés Celsius au niveau de la mer.', truthLabel: ClaimTruthLabel.TRUE, category: 'science', sourceUrl: 'https://www.usgs.gov/special-topics/water-science-school/science/boiling-water' },
  { id: 'cdddddddddddddddddddddddd', text: 'Les humains possèdent quatre poumons fonctionnels.', truthLabel: ClaimTruthLabel.FALSE, category: 'biology', sourceUrl: 'https://www.britannica.com/science/lung' },
];

// The versioned editorial source is the single source of truth for seeded
// claims. The legacy array above is kept temporarily for migration readability.
// Les quatre claims d'origine servent à la manche d'historique plus bas, qui
// les cherche par sourceKey. Le corpus généré apporte les clips jouables, avec
// leur vidéo et leur explication. On charge les deux : remplacer l'un par
// l'autre faisait échouer le seed, et le back ne démarrait plus du tout.
const demoClaims = [
  ...require('./data/editorial-claims.json'),
  ...require('./data/editorial-claims.generated.json'),
];
// SHA-256 fingerprint of the historical admin password. The plaintext is
// intentionally not kept in the source anymore, but the compromised value is
// still rejected if someone tries to provide it through the environment.
const REVOKED_ADMIN_PASSWORD_SHA256 = '2deb3b2684e86ef37f8954afe4d6c2f53205e5b885e7ebc1f6cd720c387a076b';

function isRevokedAdminPassword(password) {
  return crypto.createHash('sha256').update(password, 'utf8').digest('hex') === REVOKED_ADMIN_PASSWORD_SHA256;
}

function demoDataEnabled() {
  if (process.env.SEED_DEMO_DATA !== undefined) {
    return process.env.SEED_DEMO_DATA.toLowerCase() === 'true';
  }
  return process.env.NODE_ENV !== 'production';
}

async function upsertUser({ id, email, displayName, role = 'USER', password }) {
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.upsert({
    where: { email },
    update: { displayName, role, passwordHash, status: 'OFFLINE' },
    create: { id, email, displayName, role, passwordHash, virtualBalance: 1000 },
  });
}

async function seedAdmin() {
  const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase();
  const isProduction = nodeEnv === 'production';
  const configuredEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const configuredPassword = process.env.SEED_ADMIN_PASSWORD?.trim();

  if (!configuredEmail && !demoDataEnabled()) {
    if (isProduction && configuredPassword) {
      throw new Error('SEED_ADMIN_EMAIL is required when SEED_ADMIN_PASSWORD is set in production');
    }
    return null;
  }

  if (!configuredPassword) {
    throw new Error(
      isProduction
        ? 'SEED_ADMIN_PASSWORD is required to seed an administrator in production'
        : 'SEED_ADMIN_PASSWORD is required to seed an administrator; the historical demo password has been revoked',
    );
  }

  if (isRevokedAdminPassword(configuredPassword)) {
    throw new Error('SEED_ADMIN_PASSWORD is a revoked compromised password');
  }

  if (isProduction && !configuredEmail) {
    throw new Error('SEED_ADMIN_EMAIL is required to seed an administrator in production');
  }

  return upsertUser({
    id: ids.admin,
    email: configuredEmail || 'admin@factarena.local',
    displayName: 'FactArena Admin',
    role: 'ADMIN',
    password: configuredPassword,
  });
}

async function seedClaims(createdBy) {
  for (const claim of demoClaims) {
    // L'explication de révélation vit dans ClaimVerdict, pas sur Claim : on la
    // met de côté avant l'upsert, sinon Prisma refuse le champ.
    const { verdict, ...champs } = claim;
    const data = createdBy ? { ...champs, createdBy } : { ...champs };
    const enregistree = await prisma.claim.upsert({
      where: { sourceKey: claim.sourceKey },
      update: data,
      create: data,
    });
    if (!verdict) continue;
    await prisma.claimVerdict.upsert({
      where: { claimId: enregistree.id },
      update: { verdictText: verdict.verdictText, confidence: verdict.confidence, citations: verdict.citations },
      create: {
        claimId: enregistree.id,
        verdictText: verdict.verdictText,
        confidence: verdict.confidence,
        citations: verdict.citations,
      },
    });
  }
}

async function seedDemoData(admin) {
  const demoPassword = process.env.SEED_DEMO_PASSWORD || 'FactArenaDemo!123';
  const host = await upsertUser({
    id: ids.host,
    email: 'host@factarena.local',
    displayName: 'Demo Host',
    password: demoPassword,
  });
  const player = await upsertUser({
    id: ids.player,
    email: 'player@factarena.local',
    displayName: 'Demo Player',
    password: demoPassword,
  });
  const viewer = await upsertUser({
    id: ids.viewer,
    email: 'viewer@factarena.local',
    displayName: 'Demo Viewer',
    password: demoPassword,
  });

  await prisma.room.upsert({
    where: { id: ids.waitingRoom },
    update: { name: 'Demo Room - prête à jouer', status: 'WAITING', createdBy: host.id },
    create: { id: ids.waitingRoom, name: 'Demo Room - prête à jouer', status: 'WAITING', createdBy: host.id },
  });
  await prisma.room.upsert({
    where: { id: ids.historyRoom },
    update: { name: 'Demo Room - historique', status: 'WAITING', createdBy: host.id },
    create: { id: ids.historyRoom, name: 'Demo Room - historique', status: 'WAITING', createdBy: host.id },
  });

  await prisma.round.upsert({
    where: { id: ids.historyRound },
    update: {
      roomId: ids.historyRoom,
      status: 'FINISHED',
      opensAt: new Date('2025-01-01T12:00:00.000Z'),
      locksAt: new Date('2025-01-01T12:05:00.000Z'),
      revealedAt: new Date('2025-01-01T12:06:00.000Z'),
    },
    create: {
      id: ids.historyRound,
      roomId: ids.historyRoom,
      status: 'FINISHED',
      opensAt: new Date('2025-01-01T12:00:00.000Z'),
      locksAt: new Date('2025-01-01T12:05:00.000Z'),
      revealedAt: new Date('2025-01-01T12:06:00.000Z'),
    },
  });

  const selectedSourceKeys = [
    'britannica:photography:first-permanent-photo',
    'nasa:great-wall:visible-from-moon',
    'britannica:biology:four-human-lungs',
  ];
  const selectedClaims = await Promise.all(selectedSourceKeys.map((sourceKey) =>
    prisma.claim.findUniqueOrThrow({ where: { sourceKey } }),
  ));
  const roundClaimIds = [ids.roundClaim1, ids.roundClaim2, ids.roundClaim3];
  for (const [orderIndex, claim] of selectedClaims.entries()) {
    await prisma.roundClaim.upsert({
      where: { id: roundClaimIds[orderIndex] },
      update: { roundId: ids.historyRound, claimId: claim.id, orderIndex },
      create: {
        id: roundClaimIds[orderIndex],
        roundId: ids.historyRound,
        claimId: claim.id,
        orderIndex,
      },
    });
  }

  await prisma.bet.upsert({
    where: { userId_roundId: { userId: host.id, roundId: ids.historyRound } },
    update: { stake: 100, payout: 200, result: 'WIN' },
    create: {
      id: ids.predictionHost,
      userId: host.id,
      roundId: ids.historyRound,
      stake: 100,
      payout: 200,
      result: 'WIN',
    },
  });
  await prisma.bet.upsert({
    where: { userId_roundId: { userId: player.id, roundId: ids.historyRound } },
    update: { stake: 100, payout: 0, result: 'LOSS' },
    create: {
      id: ids.predictionPlayer,
      userId: player.id,
      roundId: ids.historyRound,
      stake: 100,
      payout: 0,
      result: 'LOSS',
    },
  });

  for (const claim of selectedClaims) {
    await prisma.clipVote.upsert({
      where: { userId_roundId_claimId: { userId: host.id, roundId: ids.historyRound, claimId: claim.id } },
      update: { isFake: claim.truthLabel === 'FALSE' },
      create: { userId: host.id, roundId: ids.historyRound, claimId: claim.id, isFake: claim.truthLabel === 'FALSE' },
    });
    await prisma.clipVote.upsert({
      where: { userId_roundId_claimId: { userId: player.id, roundId: ids.historyRound, claimId: claim.id } },
      update: { isFake: claim.truthLabel !== 'FALSE' },
      create: { userId: player.id, roundId: ids.historyRound, claimId: claim.id, isFake: claim.truthLabel !== 'FALSE' },
    });
  }

  const transactions = [
    { id: ids.transactionHostBet, userId: host.id, type: 'BET', amount: -100, balanceAfter: 900 },
    { id: ids.transactionHostPayout, userId: host.id, type: 'PAYOUT', amount: 200, balanceAfter: 1100 },
    { id: ids.transactionPlayerBet, userId: player.id, type: 'BET', amount: -100, balanceAfter: 900 },
  ];
  for (const transaction of transactions) {
    await prisma.transaction.upsert({
      where: { id: transaction.id },
      update: transaction,
      create: transaction,
    });
  }
  await prisma.user.update({ where: { id: host.id }, data: { virtualBalance: 1100 } });
  await prisma.user.update({ where: { id: player.id }, data: { virtualBalance: 900 } });
  await prisma.user.update({ where: { id: viewer.id }, data: { virtualBalance: 1000 } });

  await prisma.friend.upsert({
    where: { userId_friendId: { userId: host.id, friendId: player.id } },
    update: {},
    create: { id: ids.friendship, userId: host.id, friendId: player.id },
  });
  await prisma.friend.upsert({
    where: { userId_friendId: { userId: player.id, friendId: host.id } },
    update: {},
    create: { id: `${ids.friendship.slice(0, 1)}i${ids.friendship.slice(2)}`, userId: player.id, friendId: host.id },
  });

  await prisma.message.upsert({
    where: { id: ids.message1 },
    update: { roomId: ids.historyRoom, userId: host.id, content: 'Bienvenue dans la room de démonstration.' },
    create: { id: ids.message1, roomId: ids.historyRoom, userId: host.id, content: 'Bienvenue dans la room de démonstration.' },
  });

  console.log('Demo seed ready:');
  console.log('  host@factarena.local / player@factarena.local / viewer@factarena.local');
  console.log(`  password: ${demoPassword}`);
  if (admin) console.log(`  admin: ${admin.email}`);
  console.log(`  waiting room: ${ids.waitingRoom}`);
  console.log(`  history round: ${ids.historyRound}`);
}

async function main() {
  const admin = await seedAdmin();
  await seedClaims(admin?.id ?? null);

  if (demoDataEnabled()) {
    await seedDemoData(admin);
  } else {
    console.log('Demo data disabled. Set SEED_DEMO_DATA=true to create demo users and matches.');
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
