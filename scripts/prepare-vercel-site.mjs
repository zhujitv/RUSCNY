import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = resolve(repositoryRoot, 'apps/customer-web');
const outputDirectory = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(repositoryRoot, 'services/api/public');

if (outputDirectory === sourceDirectory || !outputDirectory.startsWith(`${repositoryRoot}/`)) {
  throw new Error('Refusing to prepare the Vercel site outside the repository build directory');
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(sourceDirectory, outputDirectory, { recursive: true });

const aliases = [
  ['account.html', 'account/index.html'],
  ['account.html', 'register/index.html'],
  ['account.html', 'login/index.html'],
  ['privacy.html', 'privacy/index.html'],
  ['terms.html', 'terms/index.html'],
  ['unavailable.html', 'join/index.html'],
  ['unavailable.html', '404.html'],
  ['app.js', 'site.js'],
  ['styles.css', 'site.css'],
];

for (const [source, destination] of aliases) {
  const destinationPath = resolve(outputDirectory, destination);
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(resolve(outputDirectory, source), destinationPath);
}

console.log(`Prepared static website in ${outputDirectory}`);
