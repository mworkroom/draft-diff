import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const seen = new Set(), sections = [];
async function visit(name, parent) {
  const require = createRequire(join(parent, 'package.json'));
  let packagePath;
  try { packagePath = require.resolve(`${name}/package.json`); }
  catch {
    let location = dirname(require.resolve(name));
    while (location !== dirname(location)) {
      try {
        const candidate = JSON.parse(await readFile(join(location, 'package.json'), 'utf8'));
        if (candidate.name === name) { packagePath = join(location, 'package.json'); break; }
      } catch { /* Continue up to the package root. */ }
      location = dirname(location);
    }
  }
  if (!packagePath) throw new Error(`Cannot resolve license for ${name}`);
  if (seen.has(packagePath)) return;
  seen.add(packagePath);
  const folder = dirname(packagePath), pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  const files = (await readdir(folder)).filter(name => /^(licen[cs]e|copying)(\.|$)/i.test(name));
  let notices = (await Promise.all(files.map(name => readFile(join(folder, name), 'utf8')))).join('\n');
  if (!notices) {
    const readme = await readFile(join(folder, 'README.md'), 'utf8');
    const licenseStart = readme.search(/^##? Licen[cs]e\b/im);
    if (licenseStart < 0) throw new Error(`License text missing: ${name}`);
    notices = readme.slice(licenseStart);
  }
  sections.push(`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nDeclared license: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)}\n${'='.repeat(72)}\n${notices}`);
  for (const dependency of Object.keys(pkg.dependencies ?? {})) await visit(dependency, folder);
}
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
for (const name of Object.keys(pkg.dependencies)) await visit(name, root);
await writeFile(join(root, 'public', 'THIRD_PARTY_LICENSES.txt'), `Third-party software notices for DraftDiff\nJSZip is used under its MIT license option.\n${sections.join('\n')}`, 'utf8');
console.log(`Collected notices for ${sections.length} runtime packages.`);
