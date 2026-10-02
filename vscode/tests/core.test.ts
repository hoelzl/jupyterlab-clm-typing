// Run with: node --test tests/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  charDelay,
  hackerBurst,
  lineCol,
  minimalEdit,
  normalizeEol,
  readTyping
} from '../src/core.ts';

const typing = { start: 'a', target: 'ab' };

test('readTyping: vscode.ipynb nesting (cell.metadata.metadata)', () => {
  assert.deepEqual(readTyping({ metadata: { clm: { typing } } }), typing);
});

test('readTyping: legacy custom nesting and bare clm key', () => {
  assert.deepEqual(
    readTyping({ custom: { metadata: { clm: { typing } } } }),
    typing
  );
  assert.deepEqual(readTyping({ clm: { typing } }), typing);
});

test('readTyping: missing or malformed metadata', () => {
  assert.equal(readTyping(undefined), null);
  assert.equal(readTyping({}), null);
  assert.equal(readTyping({ metadata: { clm: { typing: { start: 'x' } } } }), null);
  assert.equal(readTyping({ metadata: { clm: 'nope' } }), null);
});

test('readTyping: start is optional; CRLF is normalized', () => {
  assert.deepEqual(readTyping({ metadata: { clm: { typing: { target: 'a\r\nb' } } } }), {
    target: 'a\nb',
    start: undefined
  });
});

test('normalizeEol', () => {
  assert.equal(normalizeEol('a\r\nb\rc\nd'), 'a\nb\nc\nd');
});

test('lineCol', () => {
  const t = 'ab\ncd\n\nef';
  assert.deepEqual(lineCol(t, 0), { line: 0, character: 0 });
  assert.deepEqual(lineCol(t, 2), { line: 0, character: 2 });
  assert.deepEqual(lineCol(t, 3), { line: 1, character: 0 });
  assert.deepEqual(lineCol(t, 7), { line: 3, character: 0 });
  assert.deepEqual(lineCol(t, t.length), { line: 3, character: 2 });
  assert.deepEqual(lineCol(t, 99), { line: 3, character: 2 });
});

test('minimalEdit', () => {
  assert.equal(minimalEdit('abc', 'abc'), null);
  assert.deepEqual(minimalEdit('ac', 'abc'), { from: 1, to: 1, text: 'b' });
  assert.deepEqual(minimalEdit('abc', 'ac'), { from: 1, to: 2, text: '' });
  assert.deepEqual(minimalEdit('x = ...', 'x = 42'), { from: 4, to: 7, text: '42' });
  // Repeated characters: prefix and suffix must not overlap.
  assert.deepEqual(minimalEdit('aa', 'aaa'), { from: 2, to: 2, text: 'a' });
  assert.deepEqual(minimalEdit('aaa', 'aa'), { from: 2, to: 3, text: '' });
});

test('minimalEdit reproduces the target (fuzz)', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const word = () =>
    Array.from({ length: Math.floor(rnd() * 8) }, () => 'ab\n '[Math.floor(rnd() * 4)]).join('');
  for (let i = 0; i < 2000; i++) {
    const a = word();
    const b = word();
    const e = minimalEdit(a, b);
    const out = e ? a.slice(0, e.from) + e.text + a.slice(e.to) : a;
    assert.equal(out, b);
  }
});

test('charDelay: jitter bounds and pauses', () => {
  assert.equal(charDelay(20, 0, 'x'), 50);
  assert.equal(charDelay(20, 0, '\n    '), 150);
  assert.equal(charDelay(20, 0.5, 'x', () => 0), 25);
  assert.equal(charDelay(20, 0.5, 'x', () => 1), 75);
});

test('hackerBurst stays within [min, max]', () => {
  assert.equal(hackerBurst(1, 3, () => 0), 1);
  assert.equal(hackerBurst(1, 3, () => 0.999), 3);
  assert.equal(hackerBurst(0, 0, () => 0.5), 1);
  assert.equal(hackerBurst(4, 2, () => 0.5), 4);
});
