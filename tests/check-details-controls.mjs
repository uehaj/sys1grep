// #234: -A/-B/-o/-j/--max-cost, the new Details controls. -A/-B/-o are nostep (go inert during a multi-step walk,
// like C/dedup already do); -o is also sentenceOnly (hidden, and never sent, unless the unit is a sentence); -j and
// --max-cost apply in a walk too (sys1grep.mjs's own multi-step conflict list does not name them).
import { toArgv, initOf } from '../serve.mjs';
const noLaunch = initOf([]);
const tuning = toArgv({ x: ['e:a'], unit: 'sentence-by-jev', A: '2', B: '1', o: true, j: '4', 'max-cost': '0.5' }, noLaunch);
const lineUnit = toArgv({ x: ['e:a'], unit: 'line', A: '2', B: '1', o: true, j: '4', 'max-cost': '0.5' }, noLaunch);
const stepped = toArgv({ x: ['e:a', 'S:', 'e:b'], A: '2', B: '1', o: true, j: '4', 'max-cost': '0.5' }, noLaunch);
console.log([
  tuning.join(' '),
  lineUnit.includes('-o'), // -o is sentenceOnly: omitted outright with unit: line, even though it was checked
  stepped.some(a => a === '-A' || a === '-B' || a === '-o'), // nostep: inert during a walk
  stepped.includes('-j') && stepped.includes('4') && stepped.some(a => a.startsWith('--max-cost=')), // not nostep
].join(' '));
