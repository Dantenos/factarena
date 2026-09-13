const { PrismaClient } = require('@prisma/client');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const REVOKED_ADMIN_PASSWORD_SHA256 = '2deb3b2684e86ef37f8954afe4d6c2f53205e5b885e7ebc1f6cd720c387a076b';

function isRevokedAdminPassword(password) {
  return crypto.createHash('sha256').update(password, 'utf8').digest('hex') === REVOKED_ADMIN_PASSWORD_SHA256;
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

  if (!configuredEmail) {
    if (isProduction && configuredPassword) {
      throw new Error('SEED_ADMIN_EMAIL is required when SEED_ADMIN_PASSWORD is set in production');
    }
    return null;
  }

  if (!configuredPassword) {
    throw new Error(
      isProduction
        ? 'SEED_ADMIN_PASSWORD is required to seed an administrator in production'
        : 'SEED_ADMIN_PASSWORD is required to seed an administrator',
    );
  }

  if (isRevokedAdminPassword(configuredPassword)) {
    throw new Error('SEED_ADMIN_PASSWORD is a revoked compromised password');
  }

  return upsertUser({
    id: 'c111111111111111111111111',
    email: configuredEmail,
    displayName: 'FactArena Admin',
    role: 'ADMIN',
    password: configuredPassword,
  });
}

async function seedClaims(createdBy) {
  const claims = [
    ...require('./data/editorial-claims.json'),
    ...require('./data/editorial-claims.generated.json'),
  ];

  for (const claim of claims) {
    const { verdict, ...fields } = claim;
    const data = createdBy ? { ...fields, createdBy } : fields;
    const storedClaim = await prisma.claim.upsert({
      where: { sourceKey: claim.sourceKey },
      update: data,
      create: data,
    });
    if (!verdict) continue;
    await prisma.claimVerdict.upsert({
      where: { claimId: storedClaim.id },
      update: { verdictText: verdict.verdictText, confidence: verdict.confidence, citations: verdict.citations },
      create: {
        claimId: storedClaim.id,
        verdictText: verdict.verdictText,
        confidence: verdict.confidence,
        citations: verdict.citations,
      },
    });
  }
}

async function main() {
  const admin = await seedAdmin();
  await seedClaims(admin?.id ?? null);
  if (admin) console.log(`Admin seeded: ${admin.email}`);
  console.log('Editorial claims seeded.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
