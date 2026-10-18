// The demo's example pills as its page sends them: 24, English 14 and 日本語 10 (a regex-only pill has no Japanese of
// its own), each with the arguments the page runs (serve.mjs's searchArgs after DEMO_LAUNCH). Shared by
// scripts/record-demo-cache.mjs, which records their requests, and tests/demo-core.mjs, which replays them.
import { DEMO_LAUNCH, EXAMPLES, initOf, searchArgs, tplOf } from '../serve.mjs';

export const INIT = initOf(DEMO_LAUNCH);
export const PILLS = EXAMPLES.flatMap(e => [['en', e.h, e.x], ...(e.xj ? [['ja', e.hj, e.xj]] : [])]
  .map(([lang, name, x]) => ({ lang, name, step: x.includes('S:'), p: { ...e, x } })));
export const argvOf = (p, kind = 'results') => [...DEMO_LAUNCH, ...searchArgs(p, kind, INIT, tplOf(DEMO_LAUNCH))];
// what the page's worker sets (demo/demo.js); the cache's own url decides the endpoint, so no key is needed or sent
export const envOf = url => ({ SYS1GREP_CACHE: 'only', SYS1GREP_URL: url });
export const DEFAULT_URL = 'https://api.typesafe.ai/v1/systemone';
