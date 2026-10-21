// node --test: lib/sentences.mjs on its own, without Jev or the CLI around it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsJudging, toSentences } from '../../lib/sentences.mjs';

const byLine = (lines, split) => toSentences(lines, i => i + 1, () => 0, split);

test('wrapped English lines join with a space; spans point back into each line', () => {
  assert.deepEqual(byLine(['The job failed', '  because the disk was full. It retried.']), [
    { text: 'The job failed because the disk was full.', spans: [[1, 0, 14], [2, 2, 28]] },
    { text: 'It retried.', spans: [[2, 29, 40]] },
  ]);
});

test('wrapped Japanese lines join without a space', () => {
  assert.deepEqual(byLine(['ディスクが', '一杯でした。']), [{ text: 'ディスクが一杯でした。', spans: [[1, 0, 5], [2, 0, 6]] }]);
});

test('a hard break never joins: blank line, code, list item, heading, number', () => {
  for (const [prev, next] of [['a', ''], ['a {', 'b'], ['a;', 'b'], ['a', '- b'], ['a', '# b'], ['a', '1. b'], ['a', 'b;']]) {
    assert.deepEqual(byLine([prev, next]).map(s => s.text), [prev, next].filter(Boolean), `${prev} / ${next}`);
  }
});

test('split forces a break the rules would join', () => {
  assert.deepEqual(byLine(['お知らせ', '明日は休みです'], new Set([1])).map(s => s.text), ['お知らせ', '明日は休みです']);
});

test('-z: one record, baseOf shifts offsets to where each line starts in it', () => {
  const rec = 'first half\nsecond half.', ls = rec.split('\n'), starts = [0, 11];
  assert.deepEqual(toSentences(ls, () => 7, i => starts[i]), [{ text: 'first half second half.', spans: [[7, 0, 10], [7, 11, 23]] }]);
});

test('needsJudging: only CJK breaks the rules would join and punctuation does not settle', () => {
  assert.ok(needsJudging('お知らせ', '明日は休み'));
  assert.ok(needsJudging('Notice', '明日は休み'));
  assert.ok(!needsJudging('終わり。', '次'), 'ends a sentence');
  assert.ok(!needsJudging('途中、', '続き'), 'ends in 、');
  assert.ok(!needsJudging('引用', '」の後'), 'next starts with closing punctuation');
  assert.ok(!needsJudging('plain', 'english'), 'no CJK');
  assert.ok(!needsJudging('お知らせ', '- 項目'), 'hard break');
  assert.ok(!needsJudging('', '次'), 'blank');
});
