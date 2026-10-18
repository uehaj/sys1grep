// node:path (posix) and node:os / node:url, as much as sys1grep.mjs uses, resolved against the run's in-memory cwd and home.
import { process } from './globals.js';

const normalize = p => {
  const out = [];
  for (const s of p.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') out.pop(); else out.push(s);
  }
  return `/${out.join('/')}`;
};
export const resolve = (...parts) => {
  let r = '';
  for (let i = parts.length - 1; i >= -1 && !r.startsWith('/'); i--) {
    const p = i >= 0 ? parts[i] : process.cwd();
    if (p) r = r ? `${p}/${r}` : p;
  }
  return normalize(r);
};
export const dirname = p => {
  const s = p.replace(/\/+$/, '') || (p.startsWith('/') ? '/' : '');
  const i = s.lastIndexOf('/');
  return i < 0 ? '.' : i === 0 ? '/' : s.slice(0, i).replace(/\/+$/, '') || '/';
};
export const homedir = () => globalThis.SYS1GREP_DEMO.home;
export const fileURLToPath = u => decodeURIComponent(new URL(u).pathname);
export default { resolve, dirname };
