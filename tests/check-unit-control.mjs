// #233: a launch --unit=function sends no --unit at all once multi-step is on (what the CLI already defaults to
// there stays in effect, nothing to override); a pick made outside multi-step still sends --unit; a pick made while
// multi-step is on is inert, like the other nostep controls (C, dedup, g), so it sends nothing either.
import { toArgv, initOf } from '../serve.mjs';
const launchFn = initOf(['--unit=function']), noLaunch = initOf([]);
const stepWithLaunchFn = toArgv({ x: ['e:a', 'S:', 'e:b'] }, launchFn);
const nonStepPick = toArgv({ x: ['e:a'], unit: 'function' }, noLaunch);
const stepPick = toArgv({ x: ['e:a', 'S:', 'e:b'], unit: 'sentence-by-jev' }, noLaunch);
console.log([
  launchFn.unit,
  stepWithLaunchFn.some(a => a.startsWith('--unit=')),
  nonStepPick.includes('--unit=function'),
  stepPick.some(a => a.startsWith('--unit=')),
].join(' '));
