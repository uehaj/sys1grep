#!/usr/bin/env node
// OFFLINE_ONLY's helper: offline.sh marks a section with a literal top-level
// `section 'NAME'` call (a no-op in a full run) right where today's heading
// comments start a group, and a literal `# offline-sections: end` line before
// the closing report. This script only reads that text; it never executes it.
//
//   list   SCRIPT                 -- print each section name, one per line
//   select SCRIPT PATTERN OUT     -- write the matching sections' source to OUT;
//                                    print "K M" (K matched, M total) and exit 0
//                                    if K>0, else exit 1
//
// PATTERN is comma-separated; a section matches when its name contains any
// piece, case-insensitively.
import { readFileSync, writeFileSync } from "node:fs";

const [, , mode, scriptPath, ...rest] = process.argv;
const markerRe = /^section '(.*)'$/;
const endRe = /^# offline-sections: end$/;

function parseSections(text) {
  const lines = text.split("\n");
  const sections = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (endRe.test(line)) break;
    const m = markerRe.exec(line);
    if (m) {
      cur = { name: m[1], body: [] };
      sections.push(cur);
      continue;
    }
    if (cur) cur.body.push(line);
  }
  return sections;
}

const sections = parseSections(readFileSync(scriptPath, "utf8"));

if (mode === "list") {
  for (const s of sections) console.log(s.name);
  process.exit(0);
}

if (mode === "select") {
  const [pattern, outPath] = rest;
  const pats = pattern
    .toLowerCase()
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const matched = sections.filter((s) =>
    pats.some((p) => s.name.toLowerCase().includes(p)),
  );
  writeFileSync(
    outPath,
    matched.map((s) => s.body.join("\n")).join("\n") + "\n",
  );
  console.log(`${matched.length} ${sections.length}`);
  process.exit(matched.length ? 0 : 1);
}

console.error(`offline-sections.mjs: unknown mode ${mode}`);
process.exit(2);
