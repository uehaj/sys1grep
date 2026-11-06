// Screenshots of the --serve page's layout with no server and no HOME: the page HTML that serve.mjs builds for the
// demo (demoPage(), the same markup and CSS --serve sends, in demo mode: no settings gear, the demo note) is written
// to a file and opened in Chromium at each width and language. For CSS/layout PRs that cannot run serve-check.
// Usage: node scripts/page-shot.mjs OUTDIR [CSS-SELECTOR]   (default selector: body, full page)
// Needs Playwright somewhere: PLAYWRIGHT_MODULE, else the global @playwright/cli or @playwright/mcp install; the
// browser is the newest ~/Library/Caches/ms-playwright/chromium-* (or ~/.cache/ms-playwright on Linux), or CHROMIUM.
import { writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { demoPage } from '../serve.mjs';

const [out, selector] = process.argv.slice(2);
if (!out) { console.error('usage: node scripts/page-shot.mjs OUTDIR [CSS-SELECTOR]'); process.exit(2); }
mkdirSync(out, { recursive: true });
const page = resolve(out, 'page.html');
writeFileSync(page, demoPage({ recorded: true }));

const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const mod = process.env.PLAYWRIGHT_MODULE ?? ['cli', 'mcp'].map(p => join(root, '@playwright', p, 'node_modules/playwright/index.mjs')).find(existsSync);
if (!mod) { console.error('page-shot: no Playwright found; npm i -g @playwright/cli, or set PLAYWRIGHT_MODULE'); process.exit(2); }
const cache = [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')].find(existsSync);
const exe = process.env.CHROMIUM ?? (() => {
  const dir = cache && readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1])[0];
  if (!dir) return undefined;
  const base = join(cache, dir);
  return [join(base, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), join(base, 'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), join(base, 'chrome-linux/chrome'), join(base, 'chrome-linux64/chrome')].find(existsSync);
})();
const { chromium } = await import(pathToFileURL(mod).href);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const shots = [];
for (const [width, locale, scheme] of [[1280, 'en-US', 'light'], [1280, 'ja-JP', 'light'], [1280, 'ja-JP', 'dark'], [800, 'ja-JP', 'light'], [375, 'ja-JP', 'light'], [375, 'en-US', 'light']]) {
  const p = await (await browser.newContext({ locale, colorScheme: scheme, viewport: { width, height: 900 } })).newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(pathToFileURL(page).href);
  await p.waitForTimeout(300);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const file = join(out, `${width}-${locale.slice(0, 2)}-${scheme}.png`);
  await (selector ? p.locator(selector).first().screenshot({ path: file }) : p.screenshot({ path: file, fullPage: true }));
  shots.push(`${file}${overflow > 0 ? `  horizontal overflow ${overflow}px` : ''}${errors.length ? `  page errors: ${errors.join('; ')}` : ''}`);
}
await browser.close();
console.log(shots.join('\n'));
