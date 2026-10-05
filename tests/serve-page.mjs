// node serve-page.mjs URL: runs the --serve page's script against a small DOM made from the page's own tags, drives the
// multi-step toggle and the example buttons, and prints what the page shows and what the server answered, one line per step.
import vm from 'node:vm';

const U = process.argv[2], html = await (await fetch(U)).text();
const text = el => (el.children.length ? el.children.map(text).join('') : String(el.text));
class El {
  constructor(tag, attrs = '') {
    Object.assign(this, { tagName: tag, children: [], style: {}, text: '', className: '', value: '', ls: {} });
    this.hidden = /\shidden(\s|=|$)/.test(attrs);
    this.checked = /\schecked(\s|=|$)/.test(attrs);
    this.disabled = /\sdisabled(\s|=|$)/.test(attrs);
  }
  append(...xs) { for (const x of xs) { x.parent = this; this.children.push(x); } }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  get firstChild() { return this.children[0]; }
  get lastChild() { return this.children.at(-1); }
  addEventListener(t, fn) { (this.ls[t] ??= []).push(fn); }
  focus() {}
  get textContent() { return this.text; }
  set textContent(t) { this.children = []; this.text = t; }
  set innerHTML(h) { this.children = []; for (const [, t, a] of h.matchAll(/<(select|input|button)(\s[^>]*)?>/g)) this.append(new El(t, a ?? '')); }
}
const byId = {}, elements = {};
for (const [, tag, attrs] of html.matchAll(/<(\w+)(\s[^>]*)?>/g)) {
  const el = new El(tag, attrs ?? ''), id = /\sid="([^"]+)"/.exec(attrs)?.[1], name = /\sname="([^"]+)"/.exec(attrs)?.[1];
  if (id) byId[id] = el;
  if (name) elements[name] = el;
}
byId.f.elements = byId.sf.elements = elements;
const sent = [];
const document = { getElementById: id => byId[id] ?? null, createElement: t => new El(t) };
const page = fetch, ctx = vm.createContext({
  document, setTimeout, URLSearchParams, AbortController, console, navigator: {},
  // a browser adds Origin to a POST; Node's fetch does not
  fetch: (path, o) => { sent.push(new URL(path, U).searchParams); return page(new URL(path, U), o?.method === 'POST' ? { ...o, headers: { ...o.headers, origin: new URL(U).origin } } : o); },
});
vm.runInContext(/<script>([\s\S]*)<\/script>/.exec(html)[1], ctx);

const fire = () => { for (const fn of byId.f.ls.change ?? []) fn(); };
const search = async () => {
  byId.f.onsubmit({ preventDefault() {} });
  while (byId.go.disabled) await new Promise(r => setTimeout(r, 20));
  const q = sent.at(-1);
  return `x=${q.getAll('x').join('|')} hops=${q.get('hops')} reverse=${q.get('reverse')} -> ${text(byId.left).split('\n').filter(Boolean).length} lines`;
};
const state = () => `steps ${!byId.steps ? 'missing' : byId.steps.hidden ? 'hidden' : 'shown'}: ${byId.cmd.textContent.replace(/^sys1grep \S+ /, '')}`;

byId.fields.children[0].lastChild.value = '/def main/';
fire();
console.log(state());
console.log(await search());
byId.step.checked = true;
fire();
console.log(state());
byId.ends.children[0].lastChild.value = '/raise /';
elements.hops.value = '1..2';
fire();
console.log(state());
console.log(await search());
// on: --hops, --reverse and a second --step-to end (added with "+", not an example) all reach the command together
document.getElementById('addend').onclick();
byId.ends.children[1].lastChild.value = '/sys\\.exit/';
elements.reverse.checked = true;
fire();
console.log(`addend + reverse: ${state()}`);
console.log(await search());
byId.ends.children[1].remove();
elements.reverse.checked = false;
fire();
byId.step.checked = false;
fire();
console.log(state());
console.log(await search());
byId.step.checked = true;
fire();
console.log(state());
const example = h => byId.ex.children.find(b => b.textContent === h).onclick();
byId.step.checked = false;
fire();
example('raise or exit (two ends)');
console.log(`on ${byId.step.checked}, ${byId.ends.children.length} ends, ${state()}`);
example('who calls it (--reverse)');
console.log(`on ${byId.step.checked}, ${byId.ends.children.length} ends, ${state()}`);
console.log(await search());
const sentBefore = sent.length;
example('raise or exit (two ends)');
for (const r of byId.ends.children) r.children[1].value = '';
fire();
byId.f.onsubmit({ preventDefault() {} });
console.log(`empty end: ${text(byId.left)}, ${sent.length - sentBefore} sent`);
const pills = byId.ex.children.filter(b => b.tagName === 'button');
console.log(`groups: ${byId.ex.children.map(b => (b.tagName === 'button' ? 'b' : `[${b.textContent}]`)).join(' ')}`);
const n0 = sent.length;
for (const b of pills) b.onclick();
console.log(`pressing every example sends ${sent.length - n0}`);
example('who calls it (--reverse)');
example('exclude with -v');
console.log(`on ${byId.step.checked}, ${state()}`);
console.log(await search());
for (const b of pills) {
  b.onclick();
  const c = state();
  await search();
  console.log(`${b.textContent}: ${c} -> ${byId.left.children.some(e => e.className === 'err') ? 'error ' + text(byId.left) : 'ok'}`);
}

// the settings panel: opening it reads the settings, Save writes them and shows the new state, a key never comes back
const settings = () => `url "${elements['set-url'].value}" ${byId['src-url'].textContent}; model "${elements['set-model'].value}" ${byId['src-model'].textContent}; key "${elements['set-key'].value}" ${elements['set-key'].placeholder}, ${byId['src-key'].textContent}; opts ${JSON.stringify(elements['set-opts'].value)}`;
byId.sd.open = true;
byId.sd.ontoggle();
while (!byId['src-url'].textContent) await new Promise(r => setTimeout(r, 20));
console.log(`opened: ${settings()}`);
Object.assign(elements['set-model'], { value: 'm7' });
Object.assign(elements['set-key'], { value: 'k7' });
Object.assign(elements['set-opts'], { value: '-n\n --level \nstrict\n' });
await byId.save.onclick();
console.log(`${byId.sst.textContent}: ${settings()}`);
