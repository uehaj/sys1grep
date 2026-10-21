// node:child_process and node:zlib: nothing the demo runs reaches them except git, which is "not found" here as it
// is on a machine without git (sys1grep then treats every file as outside a repository).
const missing = what => () => { throw Object.assign(new Error(`${what}: not available in the browser demo`), { code: 'ENOENT' }); };
export const execFileSync = missing('git');
export const spawn = missing('spawn');
export const spawnSync = missing('spawnSync');
export const gunzipSync = missing('gunzip');
