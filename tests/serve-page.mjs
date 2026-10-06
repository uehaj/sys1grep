// node serve-page.mjs URL: runs the --serve page's script against a small DOM made from the page's own tags, drives the
// multi-step toggle and the example buttons, and prints what the page shows and what the server answered, one line per step.
import vm from 'node:vm';

const U = process.argv[2], html = await (await fetch(U)).text();
const text = el => (el.children.length ? el.children.map(text).join('') : String(el.text));
class El {
  constructor(tag, attrs = '') {
    Object.assign(this, { tagName: tag, children: [], style: {}, text: '', className: '', value: '', ls: {}, attrs });
    this.hidden = /\shidden(\s|=|$)/.test(attrs);
    this.checked = /\schecked(\s|=|$)/.test(attrs);
    this.disabled = /\sdisabled(\s|=|$)/.test(attrs);
    this.type = /\stype="([^"]+)"/.exec(attrs)?.[1];
  }
  append(...xs) { for (const x of xs) { x.parent = this; this.children.push(x); } }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  get firstChild() { return this.children[0]; }
  get lastChild() { return this.children.at(-1); }
  addEventListener(t, fn) { (this.ls[t] ??= []).push(fn); }
  focus() { document.activeElement = this; }
  setAttribute(k, v) { (this.attrMap ??= {})[k] = String(v); }
  getAttribute(k) { return this.attrMap?.[k]; }
  get classList() {
    const self = this, names = () => self.className.split(/\s+/).filter(Boolean);
    return {
      add: c => { if (!names().includes(c)) self.className = [...names(), c].join(' '); },
      remove: c => { self.className = names().filter(x => x !== c).join(' '); },
      contains: c => names().includes(c),
    };
  }
  // <dialog>: a no-op model good enough for the page's own onclose/backdrop-click logic to run against.
  showModal() { this.open = true; }
  close() { this.open = false; this.onclose?.(); }
  get textContent() { return this.text; }
  set textContent(t) { this.children = []; this.text = t; }
  set innerHTML(h) { this.children = []; for (const [, t, a] of h.matchAll(/<(select|input|button)(\s[^>]*)?>/g)) this.append(new El(t, a ?? '')); }
}
// A real (parent/children) tree for the static markup, built by a small open/close stack over the HTML up to
// <script> (the script's own string literals hold tag-like text -- '<select>...', the close-icon svg -- that would
// otherwise corrupt the stack; nothing past <script> carries an id= or name= the rest of this file needs, so the
// tree stops there). void elements never push; a trailing "/>" (our inline svg's <circle/>, <line/>) never pushes.
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
// reading order, from the real tree where the static markup gives us one: the card holds the title, then the form,
// then Settings; the form holds the start group, the multi-step toggle, the end group, the run controls, the
// command line, the results, the examples, then Details.
{
  const seq = els => els.map(e => { const id = /\sid="([^"]+)"/.exec(e.attrs)?.[1], cls = /\sclass="([^"]+)"/.exec(e.attrs)?.[1]; return id ? '#' + id : cls ? '.' + cls.split(' ')[0] : e.tagName; });
  console.log(`card children: ${seq(byId.card.children).join(' ')}`);
  console.log(`form children: ${seq(byId.f.children).join(' ')}`);
  console.log(`start group: ${byId.startgrp.tagName} > ${seq(byId.startgrp.children).join(' ')}`);
  console.log(`end group: ${byId.steps.tagName} > ${seq(byId.steps.children).join(' ')}`);
  console.log(`no <header>: ${/<header[\s>]/.test(html) ? 'FAIL, still present' : 'ok'}`);
  console.log(`no logo in the toolbar: ${html.includes('class="logo"') ? 'FAIL, still present' : 'ok'}`);
  console.log(`--hops is type=text (styled like the other inputs): ${elements.hops.type === 'text' ? 'ok' : 'FAIL'}`);
  console.log(`Details/Settings checkboxes keep their native size: ${/\.grid input:not\(\[type=checkbox\]\)/.test(html) ? 'ok' : 'FAIL'}`);
  // .err's base rule must come before the dark-scheme override in the stylesheet, or the (same-specificity) base
  // rule wins regardless of color scheme -- this is a source-order check; the actual contrast is browser-measured.
  const errBase = html.indexOf('.err { color: #d93025'), errDark = html.indexOf('.err { color: #f28b82');
  console.log(`dark .err override comes after its base rule: ${errBase >= 0 && errDark > errBase ? 'ok' : 'FAIL'}`);
  // main.two's one-column breakpoint: the results now live inside the card (max 880px, ~800px inside the padding),
  // not in their own 1200px-wide element, so the breakpoint has to track the card's width, not a phone width --
  // 560px starved the two-column layout's right pane to ~200px between 561 and 800px (r2 review). This is a
  // source-level pin (playwright isn't a repo dependency, so a live-measured width isn't "easy" here); the actual
  // pane widths were measured in a real headless-Chromium render for the PR report.
  console.log(`main.two's one-column breakpoint tracks the card width (880px): ${/@media \(max-width: 880px\) \{ main\.two/.test(html) ? 'ok' : 'FAIL'}`);
  console.log(`title row: ${seq(byId.title.children).join(' ')}`);
  const insideSd = (() => { for (let p = byId.sf.parent; p; p = p.parent) if (p === byId.sd) return true; return false; })();
  console.log(`Settings is a <dialog> holding the settings form, not a bottom collapsible: ${byId.sd.tagName === 'dialog' && insideSd && !/<summary>Settings<\/summary>/.test(html) ? 'ok' : 'FAIL'}`);
  for (const n of ['step', 'edges', 'rank', 'summarize']) {
    const hasRole = new RegExp(`id="hint-${n}" role="tooltip"`).test(html), linked = new RegExp(`aria-describedby="hint-${n}"`).test(html);
    console.log(`hint-${n}: role=tooltip ${hasRole ? 'ok' : 'FAIL'}, linked by aria-describedby ${linked ? 'ok' : 'FAIL'}`);
  }
  console.log(`hints hidden by default (source): ${/\.hint \{[^}]*display: none; \}/.test(html) ? 'ok' : 'FAIL'}`);
  console.log(`hover reveal is mouse-only: ${/@media \(hover: hover\) \{ \.hintgroup:hover \.hint \{ display: block; \} \}/.test(html) ? 'ok' : 'FAIL'}`);
  console.log(`keyboard-focus of the icon and tap both reveal: ${/\.qbtn:focus-visible \+ \.hint, \.hintgroup\.open \.hint \{ display: block; \}/.test(html) ? 'ok' : 'FAIL'}`);
  const hintStepText = /<small class="hint" id="hint-step" role="tooltip">([\s\S]*?)<\/small>/.exec(html)?.[1] ?? '';
  console.log(`hint-step explains the walk: starts-with-Finds=${hintStepText.startsWith('Finds the start functions')} lines=${hintStepText.split('\n').length}`);
}
const sent = [];
const document = {
  getElementById: id => byId[id] ?? null, createElement: t => new El(t), activeElement: null, ls: {},
  addEventListener(t, fn) { (this.ls[t] ??= []).push(fn); },
  _fire(t, e) { for (const fn of this.ls[t] ?? []) fn(e); },
};
const page = fetch, ctx = vm.createContext({
  document, setTimeout, URLSearchParams, AbortController, console, navigator: {},
  // a browser adds Origin to a POST; Node's fetch does not
  fetch: (path, o) => { sent.push(new URL(path, U).searchParams); return page(new URL(path, U), o?.method === 'POST' ? { ...o, headers: { ...o.headers, origin: new URL(U).origin } } : o); },
});
vm.runInContext(/<script>([\s\S]*)<\/script>/.exec(html)[1], ctx);
console.log(`first start row: ${byId.fields.children[0].children.length} children (select, input, delete)`);

const fire = () => { for (const fn of byId.f.ls.change ?? []) fn(); };
const search = async () => {
  byId.f.onsubmit({ preventDefault() {} });
  while (byId.go.disabled) await new Promise(r => setTimeout(r, 20));
  const q = sent.at(-1);
  return `x=${q.getAll('x').join('|')} hops=${q.get('hops')} reverse=${q.get('reverse')} -> ${text(byId.left).split('\n').filter(Boolean).length} lines`;
};
const state = () => `steps ${!byId.steps ? 'missing' : byId.steps.hidden ? 'hidden' : 'shown'}: ${byId.cmd.textContent.replace(/^sys1grep \S+ /, '')}`;

byId.fields.children[0].children[1].value = '/def main/';
fire();
console.log(state());
console.log(await search());
// off: the start "+" (distinct from the end "+", and not toggle-gated) adds a second start; both reach the command
document.getElementById('add').onclick();
byId.fields.children[1].children[1].value = '/helper/';
fire();
console.log(`off, start+: ${state()}`);
console.log(await search());
// turning multi-step on keeps the start rows
byId.step.checked = true;
fire();
console.log(`on, starts kept: ${state()}`);
// on: start "+" and end "+" each add to their own group; the command carries the starts before --step-to, ends after
document.getElementById('addend').onclick();
byId.ends.children[0].children[1].value = '/raise /';
document.getElementById('addend').onclick();
byId.ends.children[1].children[1].value = '/sys\\.exit/';
fire();
console.log(`on, 2 starts + 2 ends: ${state()}`);
console.log(await search());
// each x is named for its own group and position, renumbered by show() on every change
console.log(`delete names: ${[...byId.fields.children, ...byId.ends.children].map(r => r.children[2].ariaLabel).join(' | ')}`);
// reset to the single-start, step-off baseline the rest of this file builds on
byId.fields.children[1].remove();
byId.ends.children[1].remove();
byId.ends.children[0].children[1].value = '';
byId.step.checked = false;
fire();
byId.step.checked = true;
fire();
console.log(state());
byId.ends.children[0].children[1].value = '/raise /';
elements.hops.value = '1..2';
fire();
console.log(state());
console.log(await search());
// on: --hops, --reverse and a second --step-to end (added with "+", not an example) all reach the command together
document.getElementById('addend').onclick();
byId.ends.children[1].children[1].value = '/sys\\.exit/';
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

// x on the sole remaining start row clears it instead of removing it: the start group always keeps a row to fill
console.log(`before delete: ${byId.fields.children.length} start row(s)`);
byId.fields.children[0].children[2].onclick();
console.log(`after delete: ${byId.fields.children.length} start row(s), value "${byId.fields.children[0].children[1].value}"`);

// the settings panel: the gear opens it as a modal dialog (reads the settings), Save writes them and shows the new
// state, a key never comes back; the close button closes the dialog and returns focus to the gear.
const settings = () => `url "${elements['set-url'].value}" ${byId['src-url'].textContent}; model "${elements['set-model'].value}" ${byId['src-model'].textContent}; key "${elements['set-key'].value}" ${elements['set-key'].placeholder}, ${byId['src-key'].textContent}; opts ${JSON.stringify(elements['set-opts'].value)}`;
byId.gear.onclick();
while (!byId['src-url'].textContent) await new Promise(r => setTimeout(r, 20));
console.log(`gear opens the dialog: open=${byId.sd.open}, ${settings()}`);
Object.assign(elements['set-model'], { value: 'm7' });
Object.assign(elements['set-key'], { value: 'k7' });
Object.assign(elements['set-opts'], { value: '-n\n --level \nstrict\n' });
await byId.save.onclick();
console.log(`${byId.sst.textContent}: ${settings()}`);
byId.sdx.onclick();
console.log(`the x closes the dialog and returns focus to the gear: open=${byId.sd.open}, focused=${document.activeElement === byId.gear}`);
byId.gear.onclick();
byId.sd.onclick({ target: byId.sd }); // a click that lands on the dialog itself (the backdrop), not its content
console.log(`a backdrop click closes the dialog: open=${byId.sd.open}`);

// hint tooltips: the hover/keyboard-focus reveal is pure CSS (pinned at source level above); only the tap toggle and
// its own-group Esc-close are JS, so those are what this drives.
const hintNames = ['step', 'edges', 'rank', 'summarize'];
const hintState = () => hintNames.map(n => `${n}:${byId['q-' + n].getAttribute('aria-expanded')}/${byId['hg-' + n].classList.contains('open') ? 'open' : 'closed'}`).join(' ');
console.log(`hints start closed: ${hintState()}`);
byId['q-rank'].onclick();
console.log(`tapping the rank "?" opens only it: ${hintState()}`);
document._fire('keydown', { key: 'Escape' });
console.log(`Esc closes it: ${hintState()}`);
byId['q-step'].onclick();
byId['q-edges'].onclick();
console.log(`tapping a second "?" closes the first: ${hintState()}`);
document._fire('click', {});
console.log(`a tap elsewhere closes it: ${hintState()}`);
