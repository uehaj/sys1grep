// The globals sys1grep.mjs uses, injected by esbuild (scripts/demo-build.mjs) in place of Node's own: process, Buffer,
// console, fetch. Each run's state is globalThis.SYS1GREP_DEMO, set by demo/runner.mjs before the bundle is imported:
// { argv, env, cwd, home, files, stdout: [], stderr: [], exited: null, exitCode: undefined, handlers: {} }.
// process.exit throws Exit after recording the code; what is written after it is dropped, as a real exit would.
import { format } from './util.js';

const S = () => globalThis.SYS1GREP_DEMO;
export class Exit extends Error {
  constructor(code) { super(`exit ${code}`); this.code = code; }
}
const decoder = new TextDecoder('utf-8', { ignoreBOM: true }), encoder = new TextEncoder();
const stream = name => ({
  isTTY: false,
  write(s, enc, cb) {
    if (S().exited == null) S()[name].push(typeof s === 'string' ? s : decoder.decode(s));
    const done = typeof enc === 'function' ? enc : cb;
    if (done) queueMicrotask(done);
    return true;
  },
  on() { return this; },
  once() { return this; },
});

export const process = {
  get argv() { return S().argv; },
  get env() { return S().env; },
  get exitCode() { return S().exitCode; },
  set exitCode(c) { S().exitCode = c; },
  platform: 'linux', pid: 1, execPath: '/usr/bin/node', execArgv: [], version: 'v22.0.0', versions: {},
  cwd: () => S().cwd,
  stdout: stream('stdout'),
  stderr: stream('stderr'),
  stdin: { isTTY: false, on() { return this; } },
  exit(code) {
    if (S().exited == null) S().exited = code ?? S().exitCode ?? 0;
    throw new Exit(S().exited);
  },
  on(event, fn) { (S().handlers[event] ??= []).push(fn); return process; },
  loadEnvFile() { throw new Error('no .env in the demo'); },
  emitWarning() {},
};

export class Buffer extends Uint8Array {
  static byteLength(s) { return typeof s === 'string' ? encoder.encode(s).length : s.byteLength; }
  static alloc(n) { return new Buffer(n); }
  static from(x) {
    const u = typeof x === 'string' ? encoder.encode(x) : x instanceof ArrayBuffer ? new Uint8Array(x) : Uint8Array.from(x);
    return new Buffer(u.buffer, u.byteOffset, u.length);
  }
  static isBuffer(x) { return x instanceof Buffer; }
  toString(enc = 'utf8', start = 0, end = this.length) {
    const b = this.subarray(start, end);
    if (enc === 'hex') return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    if (enc === 'latin1' || enc === 'binary') { let s = ''; for (const x of b) s += String.fromCharCode(x); return s; }
    return decoder.decode(b);
  }
}

const line = name => (...a) => process[name].write(`${format(...a)}\n`);
export const console = { log: line('stdout'), info: line('stdout'), debug: line('stdout'), error: line('stderr'), warn: line('stderr') };

// --cache=only stops a search before it would send (sys1grep.mjs's post()); this is only the backstop.
export const fetch = () => Promise.reject(new Error('the demo sends nothing to Jev'));
