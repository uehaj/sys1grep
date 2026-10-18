// One sys1grep run inside a fresh realm (a Web Worker in the page, a worker thread in tests/demo-core.mjs): the bundle
// (core.mjs) is the real sys1grep.mjs, a script that runs once at import, so each run needs a realm of its own.
// job: { argv (after "sys1grep"), env, cwd, home, files: { absolute path: text } }. Returns { code, out, err }.
export async function runOnce(coreUrl, job) {
  const st = globalThis.SYS1GREP_DEMO = {
    argv: ['node', '/sys1grep/sys1grep.mjs', ...job.argv], env: { ...job.env }, cwd: job.cwd, home: job.home, files: job.files,
    stdout: [], stderr: [], exited: null, exitCode: undefined, handlers: {},
  };
  try {
    await import(coreUrl);
  } catch (e) {
    // process.exit throws to stop the script; anything else is what Node would report as uncaught
    if (st.exited == null) for (const h of st.handlers.uncaughtException ?? []) try { h(e); } catch {}
    if (st.exited == null) { st.stderr.push(`sys1grep: ${e?.message ?? e}\n`); st.exited = 2; }
  }
  return { code: st.exited ?? st.exitCode ?? 0, out: st.stdout.join(''), err: st.stderr.join('') };
}
