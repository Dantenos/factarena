const { PrismaClient } = require('@prisma/client');
const { promises: fs } = require('node:fs');
const path = require('node:path');

const prisma = new PrismaClient();
const filenamePattern = /^[a-zA-Z0-9_-]+\.(png|jpe?g|gif|webp)$/i;
const temporaryFileMaxAgeMs = 60 * 60 * 1000;

async function main() {
  const directory = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'avatars'));
  let filenames;
  try {
    filenames = await fs.readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Avatar directory does not exist; nothing to clean.');
      return;
    }
    throw error;
  }

  const users = await prisma.user.findMany({ select: { avatarUrl: true } });
  const referenced = new Set(
    users
      .map(({ avatarUrl }) => avatarUrl?.match(/^\/api\/users\/avatars\/([a-zA-Z0-9_-]+\.(?:png|jpe?g|gif|webp))$/i)?.[1])
      .filter(Boolean),
  );

  let removed = 0;
  for (const filename of filenames) {
    const filePath = path.join(directory, filename);
    if (filename.endsWith('.upload')) {
      const file = await fs.stat(filePath);
      if (Date.now() - file.mtimeMs <= temporaryFileMaxAgeMs) continue;
    } else if (!filenamePattern.test(filename) || referenced.has(filename)) {
      continue;
    }
    await fs.unlink(filePath);
    removed += 1;
  }
  console.log(`Removed ${removed} orphaned avatar file(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
