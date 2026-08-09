const { PrismaClient, ClaimTruthLabel } = require('@prisma/client');

const prisma = new PrismaClient();

const demoClaims = [
  { id: 'caaaaaaaaaaaaaaaaaaaaaaaa', text: 'La première photographie permanente a été réalisée au XIXe siècle.', truthLabel: ClaimTruthLabel.TRUE, category: 'history', sourceUrl: 'https://www.britannica.com/technology/photography' },
  { id: 'cbbbbbbbbbbbbbbbbbbbbbbbb', text: 'La Grande Muraille de Chine est visible à l’œil nu depuis la Lune.', truthLabel: ClaimTruthLabel.FALSE, category: 'science', sourceUrl: 'https://www.nasa.gov/general/can-you-see-the-great-wall-of-china-from-space/' },
  { id: 'ccccccccccccccccccccccccc', text: 'L’eau bout à 100 degrés Celsius au niveau de la mer.', truthLabel: ClaimTruthLabel.TRUE, category: 'science', sourceUrl: 'https://www.usgs.gov/special-topics/water-science-school/science/boiling-water' },
  { id: 'cdddddddddddddddddddddddd', text: 'Les humains possèdent quatre poumons fonctionnels.', truthLabel: ClaimTruthLabel.FALSE, category: 'biology', sourceUrl: 'https://www.britannica.com/science/lung' },
];

async function main() {
  for (const claim of demoClaims) {
    const { id, ...data } = claim;
    await prisma.claim.upsert({ where: { id }, update: data, create: claim });
  }

  if (process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD) {
    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD, 12);
    await prisma.user.upsert({
      where: { email: process.env.SEED_ADMIN_EMAIL.toLowerCase() },
      update: { passwordHash, role: 'ADMIN', displayName: 'FactArena Admin' },
      create: { email: process.env.SEED_ADMIN_EMAIL.toLowerCase(), passwordHash, role: 'ADMIN', displayName: 'FactArena Admin' },
    });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
