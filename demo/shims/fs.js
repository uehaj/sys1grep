// node:fs over an in-memory tree, built once per run from globalThis.SYS1GREP_DEMO.files ({ absolute path: text }).
// Errors carry Node's code and message shape ("ENOENT: no such file or directory, open 'x'"), since sys1grep prints them.
import { Buffer } from './globals.js';
import { dirname, fileURLToPath, resolve } from './path.js';

const MESSAGES = { ENOENT: 'no such file or directory', EISDIR: 'illegal operation on a directory', ENOTDIR: 'not a directory', EEXIST: 'file already exists', ENXIO: 'no such device or address' };
const fail = (code, syscall, p) => Object.assign(new Error(`${code}: ${MESSAGES[code]}, ${syscall} '${p}'`), { code, syscall, path: String(p) });
const pathOf = p => (p instanceof URL ? fileURLToPath(p) : String(p));

let tree;
const T = () => {
  if (tree) return tree;
  tree = { files: new Map(), dirs: new Set(['/']), now: Date.now() };
  for (const [p, text] of Object.entries(globalThis.SYS1GREP_DEMO.files)) put(p, Buffer.from(text));
  return tree;
};
const addDirs = p => { for (let d = dirname(p); !tree.dirs.has(d); d = dirname(d)) tree.dirs.add(d); };
const put = (p, data) => { tree.files.set(p, { data, mtimeMs: tree.now }); addDirs(p); };

const stats = (dir, f) => ({
  isFile: () => !dir, isDirectory: () => dir, isSymbolicLink: () => false,
  size: dir ? 0 : f.data.length, mode: dir ? 0o40755 : 0o100644,
  mtimeMs: dir ? T().now : f.mtimeMs, mtime: new Date(dir ? T().now : f.mtimeMs),
});
export function statSync(p, { throwIfNoEntry = true } = {}) {
  const a = resolve(pathOf(p)), t = T();
  if (t.dirs.has(a)) return stats(true);
  if (t.files.has(a)) return stats(false, t.files.get(a));
  if (throwIfNoEntry) throw fail('ENOENT', 'stat', pathOf(p));
  return undefined;
}
export const lstatSync = (p, o) => {
  try { return statSync(p, o); } catch (e) { e.message = e.message.replace(', stat ', ', lstat '); e.syscall = 'lstat'; throw e; }
};
export const existsSync = p => { try { return !!statSync(p, { throwIfNoEntry: false }); } catch { return false; } };
export function readdirSync(p, { withFileTypes } = {}) {
  const a = resolve(pathOf(p)), t = T();
  if (!t.dirs.has(a)) throw fail(t.files.has(a) ? 'ENOTDIR' : 'ENOENT', 'scandir', pathOf(p));
  const prefix = a === '/' ? '/' : `${a}/`, names = new Map();
  for (const f of t.files.keys()) if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) names.set(f.slice(prefix.length), false);
  for (const d of t.dirs) if (d !== a && d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) names.set(d.slice(prefix.length), true);
  const list = [...names].sort(([x], [y]) => (x < y ? -1 : 1));
  return withFileTypes ? list.map(([name, dir]) => ({ name, isDirectory: () => dir, isFile: () => !dir, isSymbolicLink: () => false })) : list.map(([n]) => n);
}
export function readFileSync(p, o) {
  const enc = typeof o === 'string' ? o : o?.encoding;
  let data;
  if (p === 0) data = Buffer.alloc(0); // stdin: the demo always has targets, so this is the "no input" case
  else {
    const a = resolve(pathOf(p)), t = T();
    if (t.dirs.has(a)) throw fail('EISDIR', 'read', pathOf(p));
    if (!t.files.has(a)) throw fail('ENOENT', 'open', pathOf(p));
    data = t.files.get(a).data;
  }
  return enc ? data.toString(enc) : Buffer.from(data);
}
export function writeFileSync(p, data, o) {
  const a = resolve(pathOf(p)), t = T();
  if (o?.flag === 'wx' && t.files.has(a)) throw fail('EEXIST', 'open', pathOf(p));
  if (!t.dirs.has(dirname(a))) throw fail('ENOENT', 'open', pathOf(p));
  put(a, Buffer.from(data));
}
export function mkdirSync(p, { recursive } = {}) {
  const a = resolve(pathOf(p)), t = T();
  if (t.dirs.has(a)) { if (!recursive) throw fail('EEXIST', 'mkdir', pathOf(p)); return; }
  if (!recursive && !t.dirs.has(dirname(a))) throw fail('ENOENT', 'mkdir', pathOf(p));
  t.dirs.add(a); addDirs(a);
}
export function renameSync(from, to) {
  const a = resolve(pathOf(from)), t = T();
  if (!t.files.has(a)) throw fail('ENOENT', 'rename', pathOf(from));
  put(resolve(pathOf(to)), t.files.get(a).data);
  t.files.delete(a);
}
export function rmSync(p, { recursive, force } = {}) {
  const a = resolve(pathOf(p)), t = T();
  if (t.files.delete(a)) return;
  if (t.dirs.has(a) && recursive) {
    for (const f of [...t.files.keys()]) if (f.startsWith(`${a}/`)) t.files.delete(f);
    for (const d of [...t.dirs]) if (d === a || d.startsWith(`${a}/`)) t.dirs.delete(d);
    return;
  }
  if (!force) throw fail('ENOENT', 'rm', pathOf(p));
}
export function copyFileSync(from, to, mode) {
  if (mode && existsSync(to)) throw fail('EEXIST', 'copyfile', pathOf(to));
  writeFileSync(to, readFileSync(from));
}
// /dev/tty: the demo has no terminal, so -i and the cost guard's question fail as they do without one.
export const openSync = p => { throw fail('ENXIO', 'open', pathOf(p)); };
export const readSync = () => { throw fail('ENXIO', 'read', 'tty'); };
export const writeSync = () => { throw fail('ENXIO', 'write', 'tty'); };
export const constants = { COPYFILE_EXCL: 1 };
