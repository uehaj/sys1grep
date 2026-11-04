// node check-cost-retry.mjs URL: #234 review item 3 -- addCostRetry (serve.mjs's "Search anyway" button) had no
// test: +0.01 could become -0.01 and CI would stay green. This drives the real page's script (a trimmed copy of
// serve-page.mjs's own El/DOM shim; the full file is wired to a different fixture and a free local Jev, which never
// crosses --max-cost) against a --serve started over the cost guard (tests/offline.sh's "serve: cost guard"
// section), and checks: the button appears with the price the guard's own refusal named, clicking it sends exactly
// one more request carrying that --max-cost, and that request succeeds. The multi-step "no button" branch (also
// #234 review) is pure (costRetryOf(p, error) alone decides it, with no DOM of its own) and is unit-tested directly
// in check-details-controls.mjs instead of re-driven here.
import { refuseRealHome } from './home-guard.mjs';

refuseRealHome('check-cost-retry.mjs');

const U = process.argv[2], html = await (await fetch(U)).text();
class El {
  constructor(tag, attrs = '') {
    const attrMap = {};
    for (const m of attrs.matchAll(/([a-zA-Z][\w-]*)(?:="([^"]*)")?/g)) attrMap[m[1]] = m[2] ?? '';
    Object.assign(this, { tagName: tag, children: [], style: {}, text: '', className: attrMap.class ?? '', value: '', ls: {}, attrs, attrMap });
    this.hidden = /\shidden(\s|=|$)/.test(attrs);
    this.checked = /\schecked(\s|=|$)/.test(attrs);
    this.disabled = /\sdisabled(\s|=|$)/.test(attrs);
    this.type = attrMap.type;
  }
  append(...xs) { for (const x of xs) { x.parent = this; this.children.push(x); } }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  get firstChild() { return this.children[0]; }
  querySelector(tag) { for (const c of this.children) { const m = c.tagName === tag ? c : c.querySelector(tag); if (m) return m; } return null; }
  get parentElement() { return this.parent; }
  get lastChild() { return this.children.at(-1); }
  addEventListener(t, fn) { (this.ls[t] ??= []).push(fn); }
  focus() {} blur() {}
  setAttribute(k, v) { this.attrMap[k] = String(v); }
  getAttribute(k) { return this.attrMap[k]; }
  get classList() { return { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : String(this.text); }
  set textContent(t) { this.children = []; this.text = t; }
  set innerHTML(h) { this.children = []; for (const [, t, a] of h.matchAll(/<(select|input|button)(\s[^>]*)?>/g)) this.append(new El(t, a ?? '')); }
}
const VOID = new Set(['meta', 'link', 'input', 'br', 'hr', 'img', 'source', 'col', 'area', 'base']);
const byId = {}, elements = {};
{
  const root = new El('root'), stack = [root];
  const staticHtml = html.slice(0, html.indexOf('<script'));
  for (const m of staticHtml.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s[^<>]*)?)(\/?)>/g)) {
    const [, closing, tag, attrs, selfClose] = m;
    if (closing) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === tag) { stack.length = i; break; } continue; }
    const el = new El(tag, attrs ?? ''), id = /\sid="([^"]+)"/.exec(attrs)?.[1], name = /\sname="([^"]+)"/.exec(attrs)?.[1];
    stack.at(-1).append(el);
    if (id) byId[id] = el;
    if (name) elements[name] = el;
    if (!selfClose && !VOID.has(tag)) stack.push(el);
  }
}
byId.f.elements = byId.sf.elements = elements;
const sent = [];
const document = {
  getElementById: id => byId[id] ?? null, createElement: t => new El(t), activeElement: null, ls: {}, body: new El('body'), documentElement: { clientWidth: 1000, clientHeight: 800 },
  addEventListener() {}, _fire() {},
};
const { default: vm } = await import('node:vm');
const ctx = vm.createContext({
  document, setTimeout, URLSearchParams, AbortController, console, navigator: {}, window: { ls: {}, addEventListener(t, fn) { (this.ls[t] ??= []).push(fn); } },
  getComputedStyle: () => ({ position: 'absolute' }),
  fetch: (path, o) => { sent.push(new URL(path, U).searchParams); return fetch(new URL(path, U), o?.method === 'POST' ? { ...o, headers: { ...o.headers, origin: new URL(U).origin } } : o); },
});
vm.runInContext(/<script>([\s\S]*)<\/script>/.exec(html)[1], ctx);

byId.fields.children[0].firstChild.value = 'e';
byId.fields.children[0].children[1].value = 'cat';
byId.f.onsubmit({ preventDefault() {} });
while (byId.go.disabled) await new Promise(r => setTimeout(r, 20));

const button = byId.left.children.find(c => c.tagName === 'button');
const m = button && /^Search anyway \(--max-cost ([\d.]+)\)$/.exec(button.textContent);
console.log(`button text: ${button ? button.textContent : 'none'}; matches the expected shape: ${!!m}`);
if (m) {
  const before = sent.length;
  button.onclick();
  while (byId.go.disabled) await new Promise(r => setTimeout(r, 20));
  console.log(`clicking it sent ${sent.length - before} more request(s), with --max-cost=${sent.at(-1).get('max-cost')} (named: ${m[1]})`);
  console.log(`the rerun's own result: ${byId.left.children.some(c => c.className === 'err') ? 'still an error' : 'ok, text on screen'}`);
}
