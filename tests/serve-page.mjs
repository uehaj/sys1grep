// node serve-page.mjs URL: runs the --serve page's script against a small DOM made from the page's own tags, drives the
// multi-step toggle and the example buttons, and prints what the page shows and what the server answered, one line per step.
import vm from 'node:vm';
import { refuseRealHome } from './home-guard.mjs';

refuseRealHome('serve-page.mjs'); // its Save button writes the settings of the --serve it is pointed at

const U = process.argv[2], html = await (await fetch(U)).text();
const TARGETS = [...(/id="tg-files"(.*?)id="tg-git"/.exec(html)?.[1] ?? '').matchAll(/<code>([^<]*)<\/code>/g)].map(m => m[1]);
const HINTS = [...html.matchAll(/id="hg-([\w-]+)"/g)].map(m => m[1]); // every "?" hint of the page
const text = el => (el.children.length ? el.children.map(text).join('') : String(el.text));
class El {
  constructor(tag, attrs = '') {
    // attrMap starts from the real HTML attributes (role, aria-*, autofocus, ...), not just what setAttribute()
    // writes later, or a pin that reads an attribute set only in markup (e.g. the initial aria-expanded) saw undefined.
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
  querySelector(tag) { for (const c of this.children) { const m = c.tagName === tag ? c : c.querySelector(tag); if (m) return m; } return null; } // a tag name only
  get parentElement() { return this.parent; }
  get lastChild() { return this.children.at(-1); }
  addEventListener(t, fn) { (this.ls[t] ??= []).push(fn); }
  focus() { document.activeElement = this; }
  blur() { if (document.activeElement === this) document.activeElement = null; }
  setAttribute(k, v) { this.attrMap[k] = String(v); }
  getAttribute(k) { return this.attrMap[k]; }
  get classList() {
    const self = this, names = () => self.className.split(/\s+/).filter(Boolean);
    return {
      add: c => { if (!names().includes(c)) self.className = [...names(), c].join(' '); },
      remove: c => { self.className = names().filter(x => x !== c).join(' '); },
      contains: c => names().includes(c),
      toggle: (c, on) => { on ? self.classList.add(c) : self.classList.remove(c); return on; },
    };
  }
  // <dialog>: a no-op model good enough for the page's own onclose/backdrop-click logic to run against.
  showModal() { this.open = true; }
  close() { this.open = false; this.onclose?.(); }
  // no layout engine here: by default a hidden (zero-width) box, so clampHint() leaves a hint alone; a test that
  // drives the clamp sets rect, or a function of the element's inline style for a box that moves when restyled.
  getBoundingClientRect() { return typeof this.rect === 'function' ? this.rect(this.style) : this.rect ?? { left: 100, right: 100, top: 0, bottom: 0, width: 0, height: 0 }; }
  get textContent() { return text(this); } // a browser's: the text of every descendant
  set textContent(t) { this.children = []; this.text = t; }
  set innerHTML(h) { this.children = []; for (const [, t, a] of h.matchAll(/<(select|input|button)(\s[^>]*)?>/g)) this.append(new El(t, a ?? '')); }
  // an <iframe>'s srcdoc loads asynchronously, as a real browser's does (the page awaits onload before reading its
  // text, #231): contentDocument stays unset until a later task fires onload (a macrotask, not a microtask, so a
  // caller that merely queues a .then() without awaiting show1's own promise still runs first and sees it empty),
  // with the srcdoc's own text (tags stripped) as its body.
  set srcdoc(h) {
    this._srcdoc = h;
    setTimeout(() => {
      this._contentDocument = { body: { innerText: h.replace(/<[^>]*>/g, '') }, documentElement: { scrollHeight: h.length } };
      this.onload?.();
    }, 0);
  }
  get srcdoc() { return this._srcdoc; }
  get contentDocument() { return this._contentDocument; }
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
// reading order, from the real tree where the static markup gives us one: the card holds the title, the form, the
// results, then Settings; the form holds the search card (Target, Search conditions: the start group, the multi-step
// toggle, the end group; Search, Estimate cost, Stop at its side), the examples and Options side by side, the command
// line, then Details.
{
  const seq = els => els.map(e => { const id = /\sid="([^"]+)"/.exec(e.attrs)?.[1], cls = /\sclass="([^"]+)"/.exec(e.attrs)?.[1]; return id ? '#' + id : cls ? '.' + cls.split(' ')[0] : e.tagName; });
  console.log(`card children: ${seq(byId.card.children).join(' ')}`);
  console.log(`form children: ${seq(byId.f.children).join(' ')}`);
  console.log(`sections: ${[...html.matchAll(/<h2 class="sech"[^>]*>([^<]*)</g)].map(m => m[1]).join(' | ')}; Details ${byId.d.tagName === 'details' ? 'stays the fold' : 'FAIL'}`);
  console.log(`search conditions: ${seq(byId['sec-cond'].children).join(' ')}`);
  console.log(`options: ${seq(byId['sec-opts'].children).join(' ')}`);
  console.log(`start group: ${byId.startgrp.tagName} > ${seq(byId.startgrp.children).join(' ')}`);
  console.log(`end group: ${byId.steps.tagName} > ${seq(byId.steps.children).join(' ')}`);
  console.log(`target: ${TARGETS.join(' | ')}`);
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
  console.log(`the dialog has an accessible name (aria-labelledby its heading): ${byId.sd.getAttribute('aria-labelledby') === 'sdh' && byId.sdh?.tagName === 'h2' ? 'ok' : 'FAIL'}`);
  console.log(`the url field is the dialog's initial focus, not the close button: ${elements['set-url'].getAttribute('autofocus') !== undefined ? 'ok' : 'FAIL'}`);
  for (const n of HINTS) {
    const hasRole = new RegExp(`id="hint-${n}" role="tooltip"`).test(html), linked = new RegExp(`aria-describedby="hint-${n}"`).test(html);
    console.log(`hint-${n}: role=tooltip ${hasRole ? 'ok' : 'FAIL'}, linked by aria-describedby ${linked ? 'ok' : 'FAIL'}, aria-controls ${byId['q-' + n].getAttribute('aria-controls') === 'hint-' + n ? 'ok' : 'FAIL'}`);
  }
  console.log(`hints hidden by default (source): ${/\.hint \{[^}]*display: none; pointer-events: none; \}/.test(html) ? 'ok' : 'FAIL'}`);
  // the hover trigger is the icon's own small box (.hintctl), not the whole label row (.hintgroup) below which the
  // multi-step and edges hints sit -- a row-wide trigger stayed open over the content below and (being the tooltip's
  // own ancestor) never lost :hover while the pointer crossed it, so a click on the end field or the edges "?" never
  // reached them (r1 review). pointer-events: none is the second line of defense: even if a future rule re-widens
  // the trigger, the tooltip itself cannot be the elementFromPoint hit, so a click always reaches what is under it.
  console.log(`hover reveal is scoped to the icon, not the whole row: ${/@media \(hover: hover\) \{ \.hintctl:hover \.hint \{ display: block; \} \}/.test(html) ? 'ok' : 'FAIL'}`);
  console.log(`a shown hint never blocks clicks (pointer-events: none): ${/\.hint \{[^}]*pointer-events: none; \}/.test(html) ? 'ok' : 'FAIL'}`);
  console.log(`keyboard-focus of the icon and tap both reveal: ${/\.qbtn:focus-visible \+ \.hint, \.hintgroup\.open \.hint \{ display: block; \}/.test(html) ? 'ok' : 'FAIL'}`);
  // r2 review: a bottom banner as far out as 1200px left the tooltip nowhere near the "?" at common tablet/laptop
  // widths; it is now next to the icon (left-aligned, right-aligned for rank/summarize whose icon sits at the right
  // of its row) at every width down to 480px, where it still becomes the bottom banner (small enough that nothing
  // reasonably fits beside the icon).
  console.log(`the tooltip is left-aligned to its icon, not centered under it: ${/\.hint \{[^}]*left: 0;[^}]*top: 100%;/.test(html) ? 'ok' : 'FAIL'}`);
  console.log(`rank/summarize (right side of their row) right-align instead: ${html.includes('#hg-rank .hint, #hg-summarize .hint { left: auto; right: 0; }') ? 'ok' : 'FAIL'}`);
  // multi-step and edges open above their icon instead: the control the user needs next (the end group, below
  // multi-step; --hops/reverse, which can wrap below edges' icon) must stay reachable, and pointer-events: none
  // already makes that safe either way -- opening upward removes the overlap outright for the common case.
  console.log(`multi-step and edges open above their icon, not over what is below: ${html.includes('#hg-step .hint, #hg-edges .hint { top: auto; bottom: 100%;') ? 'ok' : 'FAIL'}`);
  console.log(`the bottom-banner fallback is back to <=480px, not 1200px: ${/@media \(max-width: 480px\) \{ \.hint,/.test(html) && !html.includes('1200px') ? 'ok' : 'FAIL'}`);
  // mutation-provable: the three rules below are the only ones in the stylesheet that touch .hint's display. A
  // fourth -- an unconditional override appended later, e.g. ".hintgroup .hint { display: block; }", which the
  // string checks above do not rule out on their own -- would turn every tooltip permanently visible; stripping the
  // three known-good rules by their exact text and then searching what is left for another .hint/display pairing
  // catches it. Verified by injecting exactly that mutation into a scratch copy of this page: this line prints FAIL.
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const known = [
    '.hint { position: absolute; z-index: 30; left: 0; top: 100%; margin-top: 6px; width: max-content; max-width: min(360px, calc(100vw - 32px)); padding: 8px 10px; background: var(--code); color: var(--code-fg); font-size: 11px; line-height: 1.5; white-space: pre-line; text-align: left; border-radius: 8px; box-shadow: var(--shadow); display: none; pointer-events: none; }',
    '.hintctl:hover .hint { display: block; }',
    '.qbtn:focus-visible + .hint, .hintgroup.open .hint { display: block; }',
  ];
  const stripped = known.reduce((s, k) => s.split(k).join(''), style);
  console.log(`no stray rule overrides a hint's display beyond those three: ${/\.hint\b[^{}]*\{[^{}]*display\s*:/.test(stripped) ? 'FAIL' : 'ok'}`);
  const hintStepText = /<small class="hint" id="hint-step" role="tooltip">([\s\S]*?)<\/small>/.exec(html)?.[1] ?? '';
  console.log(`hint-step explains the walk: starts-with-Finds=${hintStepText.startsWith('Finds the start functions')} lines=${hintStepText.split('\n').length}`);
  // the "?" tooltip now says what the label's own title= used to (r2 review: avoid keeping the same explanation in
  // two places); --hops and the "edges" note have no "?" of their own and keep theirs.
  const noTitle = n => byId['hg-' + n].children[0].getAttribute('title') === undefined;
  console.log(`a label with a "?" no longer also carries a duplicate title=: step ${noTitle('step') ? 'ok' : 'FAIL'}, rank ${noTitle('rank') ? 'ok' : 'FAIL'}, summarize ${noTitle('summarize') ? 'ok' : 'FAIL'}`);
  console.log(`--hops keeps its own title= (not a duplicate): ${elements.hops.parent.getAttribute('title') !== undefined ? 'ok' : 'FAIL'}`);
}
const sent = [], posts = [];
const document = {
  getElementById: id => byId[id] ?? null, createElement: t => new El(t), activeElement: null, ls: {}, body: new El('body'), documentElement: { clientWidth: 1000, clientHeight: 800 },
  addEventListener(t, fn) { (this.ls[t] ??= []).push(fn); },
  _fire(t, e) { for (const fn of this.ls[t] ?? []) fn(e); },
};
const page = fetch, ctx = vm.createContext({
  document, setTimeout, URLSearchParams, AbortController, console, navigator: {}, window: { ls: {}, addEventListener(t, fn) { (this.ls[t] ??= []).push(fn); } },
  getComputedStyle: el => ({ position: el.position ?? 'absolute' }),
  // a browser adds Origin to a POST; Node's fetch does not
  fetch: (path, o) => { sent.push(new URL(path, U).searchParams); if (o?.method === 'POST') posts.push([new URL(path, U).pathname, o.body]); return page(new URL(path, U), o?.method === 'POST' ? { ...o, headers: { ...o.headers, origin: new URL(U).origin } } : o); },
});
vm.runInContext(/<script>([\s\S]*)<\/script>/.exec(html)[1], ctx);
console.log(`first start row: ${byId.fields.children[0].children.length} children (select, input, delete)`);

const fire = () => { for (const fn of byId.f.ls.change ?? []) fn(); };
const search = async () => {
  byId.f.onsubmit({ preventDefault() {} });
  // the ring and the dimmed results are #m.busy's CSS, aria-busy the screen reader's word for them: on with Search, off at the end
  const busyAt = () => (byId.m.classList.contains('busy') ? 'busy' : 'idle') + '/aria-busy=' + byId.m.getAttribute('aria-busy');
  const during = busyAt();
  while (byId.go.disabled) await new Promise(r => setTimeout(r, 20));
  const q = sent.at(-1);
  return `x=${q.getAll('x').join('|')} hops=${q.get('hops')} reverse=${q.get('reverse')} -> ${text(byId.left).split('\n').filter(Boolean).length} lines; ${during} then ${busyAt()}`;
};
const state = () => `steps ${!byId.steps ? 'missing' : byId.steps.hidden ? 'hidden' : 'shown'}: ${byId.cmd.textContent.replace(/^sys1grep \S+ /, '')}`;

console.log(`the first start field is a question (-Q) by default: ${byId.fields.children[0].firstChild.value === 'Q' ? 'ok' : 'FAIL'}`);
// #234 review: -o is shown only with a sentence unit (owner, #211 item 10); hg-o is hidden by default (unit: line)
// and un-hides for sentence-by-jev / sentence-by-rule, then hides again once the unit picks away from a sentence.
console.log(`-o hidden by default (unit: line): ${byId['hg-o'].hidden}`);
elements.unit.value = 'sentence-by-jev'; fire();
console.log(`-o shown with a sentence unit: ${!byId['hg-o'].hidden}`);
elements.unit.value = 'function'; fire();
console.log(`-o hidden again once the unit is not a sentence: ${byId['hg-o'].hidden}`);
elements.unit.value = 'line'; fire();
byId.fields.children[0].firstChild.value = 'P'; // the walk below starts from a regex: -P, not -Q (never a regex) or -e (no longer one)
byId.fields.children[0].children[1].value = '/def main/';
fire();
console.log(state());
console.log(await search());
// #216: -g reads git log, not the targets: Target says so while it is on, and goes back when it is off
const tg = () => `files ${byId['tg-files'].hidden ? 'hidden' : 'shown'}, git log ${byId['tg-git'].hidden ? 'hidden' : 'shown'}`;
console.log(`target: ${tg()}`);
elements.g.checked = true;
fire();
console.log(`-g on, target: ${tg()}`);
elements.g.checked = false;
fire();
console.log(`-g off, target: ${tg()}`);
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
byId.ends.children[0].firstChild.value = 'P';
byId.ends.children[0].children[1].value = '/raise /';
document.getElementById('addend').onclick();
byId.ends.children[1].firstChild.value = 'P';
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
byId.ends.children[0].children[1].value = '/raise /'; // kind is still -P, set above and untouched by the reset
elements.hops.value = '1..2';
fire();
console.log(state());
console.log(await search());
// on: --hops, reverse (--step-reverse-to) and a second end (added with "+", not an example) all reach the command together
document.getElementById('addend').onclick();
byId.ends.children[1].firstChild.value = 'P';
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
example('throw or exit (two ends)');
console.log(`on ${byId.step.checked}, ${byId.ends.children.length} ends, ${state()}`);
example('what reaches it (--step-reverse-to)');
console.log(`on ${byId.step.checked}, ${byId.ends.children.length} ends, ${state()}`);
console.log(await search());
const sentBefore = sent.length;
example('throw or exit (two ends)');
for (const r of byId.ends.children) r.children[1].value = '';
fire();
byId.f.onsubmit({ preventDefault() {} });
console.log(`empty end: ${text(byId.left)}, ${sent.length - sentBefore} sent`);
const pills = byId.ex.children.filter(b => b.tagName === 'button');
console.log(`groups: ${byId.ex.children.map(b => (b.tagName === 'button' ? 'b' : `[${b.textContent}]`)).join(' ')}`);
const n0 = sent.length;
for (const b of pills) b.onclick();
console.log(`pressing every example sends ${sent.length - n0}`);
example('what reaches it (--step-reverse-to)');
example('exclude with -v');
console.log(`on ${byId.step.checked}, ${state()}`);
console.log(await search());
for (const b of pills) {
  b.onclick();
  const c = state();
  await search();
  console.log(`${b.textContent}: ${c} -> ${byId.left.children.some(e => e.className === 'err') ? 'error ' + text(byId.left) : 'ok'}`);
}

// #215: EN / 日本語 redraws the examples' labels and fields (the multi-step ones keep their regexes), sends nothing, and
// with no storage at all (none here) starts in English and still switches
const exState = () => {
  const bs = byId.ex.children.filter(b => b.tagName === 'button');
  const grp = byId.ex.children.find(b => b.className === 'note grp');
  return `${byId['ex-ja'].getAttribute('aria-pressed') === 'true' ? 'ja' : 'en'}: ${bs.length} buttons, "${bs[0].textContent}" (lang ${bs[0].lang ?? 'none'}) .. "${bs.at(-1).textContent}" (lang ${bs.at(-1).lang}), heading "${grp.textContent}" (lang ${grp.lang})`;
};
const n1 = sent.length;
console.log(`examples ${exState()}`);
byId['ex-ja'].onclick();
console.log(`examples ${exState()}`);
for (const h of ['言葉ではなく意味で', '-v で除外', 'どこから呼ばれるか (--step-reverse-to)']) {
  byId.ex.children.find(b => b.textContent === h).onclick();
  console.log(`${h}: ${state()}`);
}
byId['ex-en'].onclick();
console.log(`examples ${exState()}; ${sent.length - n1} sent`);

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
console.log(`the x closes the dialog and returns focus to the gear: open=${byId.sd.open}, focused=${document.activeElement === byId.gear}, body scroll restored=${document.body.style.overflow !== 'hidden'}`);
byId.gear.onclick();
console.log(`reopening clears the previous save message: sst="${byId.sst.textContent}", body scroll locked=${document.body.style.overflow === 'hidden'}`);
byId.sd.onclick({ target: byId.sd }); // a click that lands on the dialog itself (the backdrop), not its content
console.log(`a backdrop click closes the dialog: open=${byId.sd.open}`);

// hint tooltips: the hover/keyboard-focus reveal is pure CSS (pinned at source level above); only the tap toggle and
// its own-group Esc-close are JS, so those are what this drives.
const hintNames = HINTS;
const hintState = () => hintNames.map(n => `${n}:${byId['q-' + n].getAttribute('aria-expanded')}/${byId['hg-' + n].classList.contains('open') ? 'open' : 'closed'}`).join(' ');
console.log(`hints start closed: ${hintState()}`);
byId['q-rank'].focus(); byId['q-rank'].onclick();
console.log(`tapping the rank "?" opens only it: ${hintState()}`);
// #214 review: Enter/Space on a "?" is a click on it; that "?" keeps focus (only the others are blurred).
console.log(`the "?" it opened keeps focus: ${document.activeElement === byId['q-rank']}`);
document._fire('keydown', { key: 'Escape' });
// r2 review: Esc must drop real focus too, or a lingering :focus-visible keeps the tip shown after .open is gone.
console.log(`Esc closes it and blurs the icon (no lingering :focus-visible): ${hintState()}, focus dropped=${document.activeElement !== byId['q-rank']}`);
byId['q-step'].onclick();
byId['q-edges'].onclick();
console.log(`tapping a second "?" closes the first: ${hintState()}`);
document._fire('click', {});
console.log(`a tap elsewhere closes it: ${hintState()}`);
// clampHint on a tap, in a 1000x800 viewport (documentElement.clientWidth/Height), against boxes laid out by hand:
// icon = the "?"'s .hintctl; the 360px tooltip is measured right-aligned to it, at a height that depends on its
// inline style (y: style => [top, bottom]).
const tap = (n, icon, y, position) => {
  Object.assign(byId['hint-' + n].parentElement, { rect: { width: 16, right: icon.left + 16, ...icon } });
  Object.assign(byId['hint-' + n], { position, rect: s => {
    const [top, bottom] = y(s);
    return { width: 360, left: s.right === '0' ? icon.left + 16 - 360 : icon.left, right: s.right === '0' ? icon.left + 16 : icon.left + 360, top, bottom };
  } });
  byId['q-' + n].onclick();
  const s = byId['hint-' + n].style;
  document._fire('click', {});
  return ['left', 'right', 'top', 'bottom', 'transform'].filter(k => s[k]).map(k => `${k}=${s[k]}`).join(' ') || 'none';
};
const below = () => [322, 372];
console.log(`an icon on the left half: left-aligned to it: ${tap('level', { left: 100, top: 300, bottom: 316 }, below)}`);
console.log(`an icon on the right half: right-aligned to it: ${tap('dedup', { left: 900, top: 300, bottom: 316 }, below)}`);
console.log(`nudged in to the 16px margin: left ${tap('T', { left: 4, top: 300, bottom: 316 }, below)}, right ${tap('C', { left: 990, top: 300, bottom: 316 }, below)}`);
console.log(`an upward tooltip past the top opens downward: ${tap('step', { left: 100, top: 30, bottom: 46 }, s => s.top === '100%' ? [52, 240] : [-164, 24])}`);
console.log(`a downward tooltip past the bottom opens upward: ${tap('t', { left: 100, top: 700, bottom: 716 }, s => s.bottom === '100%' ? [600, 694] : [722, 816])}`);
console.log(`room for neither: downward: ${tap('g', { left: 100, top: 100, bottom: 116 }, s => s.bottom === '100%' ? [-500, 94] : [122, 900])}`);
console.log(`the <=480px banner (position: fixed) is left as CSS puts it: ${tap('n', { left: 900, top: 700, bottom: 716 }, () => [700, 900], 'fixed')}`);
byId['q-rank'].onclick();
ctx.window.ls.resize.forEach(fn => fn());
console.log(`a resize closes an open tooltip: rank ${byId['hg-rank'].classList.contains('open') ? 'open' : 'closed'}`);
// #216: the targets are the launch's; nothing the page sent named one
console.log(`no request carried a target: ${TARGETS.length && sent.length && sent.every(q => ![...q.values()].some(v => TARGETS.some(t => v.includes(t)))) ? 'ok' : 'FAIL'}`);

// #227: checking summarize while results are on screen asks, inline, whether to summarize those results as they are.
// No results, or multi-step: no question. Not now sends nothing and leaves the box checked; a field changed since the
// search says the results are older; OK posts the text on screen to /summarize and sends no search.
const askState = () => (byId.ask.hidden ? 'no question' : `"${byId.askq.textContent}" [${byId['ask-ok'].textContent} / ${byId['ask-no'].textContent}] (lang ${byId.ask.lang})`);
const tick = on => { elements.summarize.checked = on; for (const fn of elements.summarize.ls.change ?? []) fn(); fire(); };
const startOn = v => { byId.fields.children[0].firstChild.value = /^\/.*\/[a-z]*$/.test(v) ? 'P' : 'e'; byId.fields.children[0].children[1].value = v; fire(); };
byId.step.checked = false;
startOn('/zzzz/');
await search();
tick(true);
console.log(`summarize, no results on screen: ${askState()}`);
tick(false);
startOn('/def main/');
await search();
const s0 = sent.length;
tick(true);
console.log(`summarize, results on screen: ${askState()}`);
byId['ask-no'].onclick();
console.log(`Not now: ${askState()}, box ${elements.summarize.checked ? 'checked' : 'unchecked'}, ${sent.length - s0} sent`);
tick(false);
tick(true);
startOn('/helper/');
console.log(`a field changed since: ${askState()}`);
byId['ex-ja'].onclick();
console.log(`日本語: ${askState()}`);
byId['ex-en'].onclick();
startOn('/def main/');
console.log(`the field back as it was: ${askState()}`);
byId.step.checked = true;
fire();
console.log(`multi-step on: ${askState()}`);
byId.step.checked = false;
fire();
tick(false);
tick(true);
const s1 = sent.length, p1 = posts.length, shownText = text(byId.left);
byId['ask-ok'].onclick();
while (byId.go.disabled) await new Promise(r => setTimeout(r, 20));
console.log(`OK: ${askState()}; sent ${posts.slice(p1).map(([p, b]) => `${p} with the results on screen ${b === shownText ? 'as they are' : 'FAIL: ' + JSON.stringify(b)}`)}, ${sent.length - s1} request(s) in all; summary pane ${byId.right.hidden ? 'hidden' : 'shown'}: ${JSON.stringify(text(byId.right))}`);

// #231: Search itself, with summarize already checked, runs the search once and summarizes the results it gets: one
// `results` request, then one `/summarize` POST over the text on screen, and no second (whole-search) `summary`
// request -- so `posts` gains exactly one entry, not zero (the old two-GET shape left posts untouched).
const s2 = sent.length, p2 = posts.length;
console.log(await search());
const shown2 = text(byId.left);
console.log(`Search with summarize on: ${sent.length - s2} request(s), ${posts.length - p2} POST(s) ${posts.slice(p2).map(([p, b]) => `${p} with the results on screen ${b === shown2 ? 'as they are' : 'FAIL: ' + JSON.stringify(b)}`)}; summary pane ${byId.right.hidden ? 'hidden' : 'shown'}: ${JSON.stringify(text(byId.right))}`);

// #231, rank on: the left pane is an iframe whose srcdoc loads asynchronously; the page must wait for it before
// posting, so the summarizer gets the cards' text, not an empty (not-yet-loaded) body. rank needs a meaning, not
// the regex this file's fields otherwise carry, so the start field switches to one here.
startOn('helper');
elements.rank.value = 'jev';
fire();
const s3 = sent.length, p3 = posts.length;
console.log(await search());
const cardsText = byId.left.querySelector('iframe').contentDocument.body.innerText;
console.log(`Search with summarize on, rank on: ${sent.length - s3} request(s), ${posts.length - p3} POST(s) ${posts.slice(p3).map(([p, b]) => `${p} with the cards' text ${b === cardsText ? 'as they are' : 'FAIL: ' + JSON.stringify(b)}`)}; summary pane ${byId.right.hidden ? 'hidden' : 'shown'}: ${JSON.stringify(text(byId.right))}`);
elements.rank.value = '';
fire();
