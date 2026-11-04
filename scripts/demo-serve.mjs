#!/usr/bin/env node
// npm run demo [-- PORT]: builds the browser demo (scripts/demo-build.mjs) into docs/demo and serves it on 127.0.0.1.
// Nothing reaches Jev or any API: sys1grep runs in the page, on the bundled examples/, with Jev's answers read from the
// recording docs/demo/cache.json (summarize is the browser's own built-in model, when it has one).
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)), dir = join(root, 'docs/demo');
execFileSync(process.execPath, [join(root, 'scripts/demo-build.mjs'), dir], { stdio: 'inherit' });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const port = Number(process.argv[2] ?? 8000);
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)); // a leading /.. collapses to /
  const file = join(dir, path.endsWith('/') ? `${path}index.html` : path);
  if (!file.startsWith(dir)) return res.writeHead(403).end();
  let body;
  try { body = await readFile(file); } catch { return res.writeHead(404).end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
}).listen(port, '127.0.0.1', () => console.log(`demo (no API calls): http://127.0.0.1:${port}/`));
