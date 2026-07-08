import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function syncVersion() {
  const rootPkgPath = resolve(__dirname, '../package.json');
  const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'));
  const version = rootPkg.version;

  if (!version) {
    throw new Error('Root package.json is missing a version field');
  }

  const targets = [
    resolve(__dirname, '../packages/app/package.json'),
    resolve(__dirname, '../packages/server/package.json'),
  ];

  const embeddedVersionPath = resolve(
    __dirname,
    '../packages/server/internal/appmeta/version.txt'
  );

  for (const target of targets) {
    const pkg = JSON.parse(await readFile(target, 'utf8'));
    if (pkg.version !== version) {
      pkg.version = version;
      await writeFile(target, JSON.stringify(pkg, null, 2) + '\n');
      console.log(`Updated ${target} to version ${version}`);
    }
  }

  await writeFile(embeddedVersionPath, `${version}\n`);
  console.log(`Updated ${embeddedVersionPath} to version ${version}`);
}

syncVersion().catch((err) => {
  console.error(err);
  process.exit(1);
});
