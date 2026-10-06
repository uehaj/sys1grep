// Every ./NAME.mjs that a file in package.json's "files" imports (statically or with await import()) must itself
// be listed in "files": npm pack ships only what's listed, so a forgotten module 404s at runtime
// (ERR_MODULE_NOT_FOUND) instead of failing a test. #199 round 3: options.mjs was added to sys1grep.mjs and
// serve.mjs but not to "files".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
const shipped = new Set(pkg.files.filter(f => f.endsWith('.mjs')));
const IMPORT = /\bfrom\s+['"]\.\/([\w.-]+\.mjs)['"]|\bimport\(\s*['"]\.\/([\w.-]+\.mjs)['"]/g;
const missing = [];
for (const f of shipped) {
  const text = readFileSync(`${root}${f}`, 'utf8');
  for (const m of text.matchAll(IMPORT)) {
    const name = m[1] ?? m[2];
    if (!shipped.has(name)) missing.push(`${f} imports ./${name}, which package.json's "files" does not list`);
  }
}
if (missing.length) { console.error(missing.join('\n')); process.exit(1); }
