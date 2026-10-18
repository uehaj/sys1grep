// One search, then demo.js throws this worker away and makes a new one for the next: see runner.mjs.
import { runOnce } from './runner.mjs';

self.onmessage = async ({ data }) => self.postMessage(await runOnce(new URL('core.mjs', import.meta.url).href, data));
