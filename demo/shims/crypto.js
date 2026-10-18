// node:crypto's createHash('sha256'), synchronous: sys1grep.mjs names each cache file by the hash of the request it
// answers, from synchronous code, so crypto.subtle (async) cannot stand in. tests/demo-shims.mjs checks it against Node.
const K = [];
for (let n = 2; K.length < 64; n++) if (![...Array(n).keys()].slice(2).some(d => n % d === 0)) K.push((Math.cbrt(n) % 1) * 2 ** 32 | 0);
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

function sha256(bytes) {
  const len = bytes.length, total = Math.ceil((len + 9) / 64) * 64, m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const view = new DataView(m.buffer);
  view.setUint32(total - 8, Math.floor(len / 2 ** 29));
  view.setUint32(total - 4, (len * 8) >>> 0);
  const h = [...H0], w = new Int32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, k].forEach((x, i) => { h[i] = (h[i] + x) | 0; });
  }
  return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

export function createHash(algorithm) {
  if (algorithm !== 'sha256') throw new Error(`the demo has only sha256, not ${algorithm}`);
  const parts = [];
  const hash = {
    update(s) { parts.push(typeof s === 'string' ? new TextEncoder().encode(s) : s); return hash; },
    digest(enc) {
      if (enc !== 'hex') throw new Error('the demo digests to hex only');
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) { all.set(p, at); at += p.length; }
      return sha256(all);
    },
  };
  return hash;
}
