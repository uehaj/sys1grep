// ~/.config/sys1grep/settings.json: the defaults for sys1grep's environment variables, one field each. Every field is
// optional; a variable set in the environment wins over its field.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

export const SETTINGS_FILE = `${homedir()}/.config/sys1grep/settings.json`;
export const SETTINGS_SHOWN = '~/.config/sys1grep/settings.json';
// field: the variable it stands for (SYS1GREP_ + this). opts is an array, one argument each, not a string to split.
export const FIELDS = { url: 'URL', key: 'API_KEY', model: 'MODEL', opts: 'OPTS', summarizer: 'SUMMARIZER', summarizerModel: 'SUMMARIZER_MODEL', summarizerKey: 'SUMMARIZER_API_KEY' };

// The checked settings, or null when there is no file. Throws an Error that names the field, never a value, for
// invalid JSON or a known field of the wrong type. An unknown field only warns (stderr) and is dropped: an older
// sys1grep must not break on a settings.json a newer one added a field to.
export const parseSettings = text => {
  let s;
  try { s = JSON.parse(text); } catch { throw new Error('not valid JSON'); } // V8's message quotes the text, which may hold a key
  if (s === null || typeof s !== 'object' || Array.isArray(s)) throw new Error('not a JSON object');
  for (const [k, v] of Object.entries(s)) {
    if (!Object.hasOwn(FIELDS, k)) {
      console.error(`sys1grep: warning: ${SETTINGS_SHOWN}: unknown field ${k} (known: ${Object.keys(FIELDS).join(', ')}); ignored`);
      delete s[k];
      continue;
    }
    if (k === 'opts' ? !(Array.isArray(v) && v.every(a => typeof a === 'string')) : typeof v !== 'string')
      throw new Error(`${k} must be ${k === 'opts' ? 'an array of strings' : 'a string'}`);
  }
  return s;
};
// Writes s after the same checks, as a whole new file (0600, its directory 0700) renamed over the old one, so a reader
// never sees half a file and the key is never readable by others, not even for a moment.
export const writeSettings = s => {
  const text = `${JSON.stringify(parseSettings(JSON.stringify(s)), null, 2)}\n`, tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true, mode: 0o700 });
  rmSync(tmp, { force: true });
  writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
  renameSync(tmp, SETTINGS_FILE);
};
export const readSettings = () => {
  let text;
  try { text = readFileSync(SETTINGS_FILE, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  return parseSettings(text);
};
