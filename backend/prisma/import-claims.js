const fs = require('node:fs/promises');
const path = require('node:path');
const { PrismaClient, ClaimTruthLabel } = require('@prisma/client');

const DEFAULT_SOURCE = path.join(__dirname, 'data', 'editorial-claims.json');
const SOURCE_KEY_PATTERN = /^[a-z0-9][a-z0-9:._-]{2,127}$/;
const ALLOWED_LABELS = new Set(Object.values(ClaimTruthLabel));

function normalizeText(value) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('fr-FR');
}

function validateUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('must use HTTPS');
    if (!url.hostname) throw new Error('must contain a hostname');
    return url.toString().replace(/\/$/, '');
  } catch (error) {
    throw new Error(`sourceUrl must be a valid HTTPS URL (${error.message})`);
  }
}

function validateClaim(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Claim #${index + 1} must be an object`);
  }

  const sourceKey = typeof raw.sourceKey === 'string' ? raw.sourceKey.trim() : '';
  const text = typeof raw.text === 'string' ? raw.text.normalize('NFKC').trim().replace(/\s+/gu, ' ') : '';
  const truthLabel = typeof raw.truthLabel === 'string' ? raw.truthLabel.trim().toUpperCase() : '';
  const category = raw.category === undefined ? null : String(raw.category).trim();

  if (!SOURCE_KEY_PATTERN.test(sourceKey)) {
    throw new Error(`Claim #${index + 1} has an invalid sourceKey`);
  }
  if (text.length < 10 || text.length > 1000) {
    throw new Error(`Claim #${index + 1} text must contain between 10 and 1000 characters`);
  }
  if (!ALLOWED_LABELS.has(truthLabel)) {
    throw new Error(`Claim #${index + 1} truthLabel must be TRUE or FALSE`);
  }
  if (category !== null && (category.length < 1 || category.length > 255)) {
    throw new Error(`Claim #${index + 1} category is invalid`);
  }

  return {
    sourceKey,
    text,
    truthLabel,
    category,
    sourceUrl: validateUrl(raw.sourceUrl),
    normalizedText: normalizeText(text),
  };
}

function validateAndDeduplicate(rawClaims) {
  if (!Array.isArray(rawClaims) || rawClaims.length === 0) {
    throw new Error('The claims source must be a non-empty JSON array');
  }

  const claims = rawClaims.map(validateClaim);
  const bySourceKey = new Map();
  const byText = new Map();

  for (const claim of claims) {
    const previousKey = bySourceKey.get(claim.sourceKey);
    if (previousKey && (previousKey.normalizedText !== claim.normalizedText || previousKey.truthLabel !== claim.truthLabel)) {
      throw new Error(`Conflicting duplicate sourceKey: ${claim.sourceKey}`);
    }
    if (previousKey) continue;

    const previousText = byText.get(claim.normalizedText);
    if (previousText && previousText.truthLabel !== claim.truthLabel) {
      throw new Error(`Conflicting truthLabel for duplicate claim text: ${claim.text}`);
    }
    if (previousText) continue;

    bySourceKey.set(claim.sourceKey, claim);
    byText.set(claim.normalizedText, claim);
  }

  return [...bySourceKey.values()];
}

async function readSource(sourceFile = process.env.CLAIMS_SOURCE_FILE || DEFAULT_SOURCE) {
  const content = await fs.readFile(sourceFile, 'utf8');
  return validateAndDeduplicate(JSON.parse(content));
}

async function resolveCreator(prisma) {
  const creatorId = process.env.CLAIMS_IMPORTER_USER_ID?.trim();
  if (creatorId) {
    const creator = await prisma.user.findUnique({ where: { id: creatorId }, select: { id: true } });
    if (!creator) throw new Error(`CLAIMS_IMPORTER_USER_ID does not reference an existing user: ${creatorId}`);
    return creator.id;
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) return null;
  const admin = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true, role: true } });
  if (!admin || admin.role !== 'ADMIN') throw new Error('SEED_ADMIN_EMAIL must reference an existing ADMIN user');
  return admin.id;
}

async function importClaims({ prisma = new PrismaClient(), sourceFile } = {}) {
  const claims = await readSource(sourceFile);
  const createdBy = await resolveCreator(prisma);
  const result = { created: 0, updated: 0, unchanged: 0, total: claims.length };

  await prisma.$transaction(async (tx) => {
    for (const claim of claims) {
      const existing = await tx.claim.findUnique({
        where: { sourceKey: claim.sourceKey },
        select: {
          id: true,
          text: true,
          truthLabel: true,
          category: true,
          sourceUrl: true,
          createdBy: true,
          roundClaims: { select: { id: true } },
        },
      });
      const data = {
        text: claim.text,
        truthLabel: claim.truthLabel,
        category: claim.category,
        sourceUrl: claim.sourceUrl,
        ...(createdBy ? { createdBy } : {}),
      };

      if (!existing) {
        await tx.claim.create({ data: { sourceKey: claim.sourceKey, ...data } });
        result.created += 1;
        continue;
      }

      const changed = existing.text !== claim.text || existing.truthLabel !== claim.truthLabel ||
        existing.category !== claim.category || existing.sourceUrl !== claim.sourceUrl ||
        (createdBy !== null && existing.createdBy !== createdBy);
      if (!changed) {
        result.unchanged += 1;
        continue;
      }
      if (existing.roundClaims?.length) {
        throw new Error(`Claim ${claim.sourceKey} is used by a round and cannot be updated`);
      }
      await tx.claim.update({ where: { sourceKey: claim.sourceKey }, data });
      result.updated += 1;
    }
  });

  return result;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await importClaims({ prisma });
    console.log(`Claims import complete: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged (${result.total} source records).`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Claims import failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { importClaims, normalizeText, validateAndDeduplicate, validateClaim };
