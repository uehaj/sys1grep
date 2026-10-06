// import { refuseRealHome } from './home-guard.mjs'; refuseRealHome('name.mjs');
// A test entry point that can start or drive sys1grep --serve must not run with the real HOME: the settings panel's
// Save writes ~/.config/sys1grep/settings.json, and a test run once left its dummy model and key there (#206).
import { realpathSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';

const real = p => { try { return realpathSync(p); } catch { return p; } };
export const isRealHome = (home = homedir()) => real(home) === real(userInfo().homedir);

export function refuseRealHome(name) {
  if (!isRealHome()) return;
  console.error(`${name}: HOME is the real home directory; run it with a temporary one (HOME=$(mktemp -d) ...), and start --serve with the same HOME`);
  process.exit(2);
}
