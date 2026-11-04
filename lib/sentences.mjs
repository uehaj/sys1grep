// Scripts written without spaces between words: joining their wrapped lines must not add a space between them,
// and sys1grep's token estimate prices them per character (cjkBytesOf).
export const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}ー、。]/u;

// --unit=sentence-by-*: the unit is a sentence. Lines are joined as wrapped prose, except where a newline cannot be inside
// a sentence: at a blank line, next to structure characters (JSON, code), or before a list item, heading, quote or
// number. Each joined piece is then split by Intl.Segmenter (Unicode UAX #29 sentence boundaries).
const SENTENCES = new Intl.Segmenter(undefined, { granularity: 'sentence' });
const hardBreak = (prev, next) => !prev || !next || /[{}\[\]<>|;]$/.test(prev) || /^[{}\[\]<>|"\-*+#>\d]/.test(next)
  || /[{}\[\];]$/.test(next); // a line ending like code is not a continuation of prose either
// lines -> [{ text, spans }]. A span [unit, from, to] is where the sentence lies in the original units: the unit
// is the 1-based line (or record) number from unitOf, from/to are character offsets inside it (baseOf shifts a
// line's offset inside its record with --unit=zero). Output maps matching sentences back to these units.
export function toSentences(lines, unitOf, baseOf, split = new Set()) { // split: breaks Jev judged to end an entry
  const out = [];
  let text = '', marks = []; // marks: { o: offset in text, unit, base: offset in the unit, len }
  const flush = () => {
    for (const seg of SENTENCES.segment(text)) {
      const t = seg.segment.trim();
      if (!t) continue;
      const start = seg.index + seg.segment.length - seg.segment.trimStart().length, end = start + t.length;
      const spans = [];
      for (const m of marks) {
        const a = Math.max(start, m.o), b = Math.min(end, m.o + m.len);
        if (a < b) spans.push([m.unit, m.base + a - m.o, m.base + b - m.o]);
      }
      out.push({ text: t, spans });
    }
    text = ''; marks = [];
  };
  lines.forEach((line, i) => {
    const prev = text.trimEnd(), next = line.trim();
    const mark = { unit: unitOf(i), base: baseOf(i) + line.length - line.trimStart().length, len: next.length };
    if (hardBreak(prev, next) || split.has(i)) { flush(); if (next) { text = next; marks.push({ ...mark, o: 0 }); } return; }
    text = prev + (CJK.test(prev.at(-1)) && CJK.test(next[0]) ? '' : ' '); // no space for scripts without word spaces
    marks.push({ ...mark, o: text.length });
    text += next;
  });
  flush();
  return out;
}

// Where the rules would join, a break still needs judging if a script without word spaces touches it and the line
// does not end a sentence: in Japanese or Chinese, entries often end without 。, and joining leaves no trace of the
// break. A line starting with closing punctuation continues the previous one (kinsoku), and so does a line
// ending in 、.
const CLOSING = /^[。、，．」』）】〕！？]/;
export const needsJudging = (prev, next) => prev && next && !hardBreak(prev, next) && !/[。！？!?、，]$/.test(prev) && !CLOSING.test(next)
  && (CJK.test(prev.at(-1)) || CJK.test(next[0]));
