// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, keystrokes, makePlan, type Plan } from '../src/planner.ts';

function typedTexts(plan: Plan): string[] {
  return plan.steps.map(s =>
    s.ops.map(o => (o.kind === 'type' ? o.text : `<del ${o.from}-${o.to}>`)).join('')
  );
}

test('empty cell is typed line by line, newline leads each step', () => {
  const target = 'int add(int a, int b) {\n    return a + b;\n}';
  const plan = makePlan('', target);
  assert.equal(plan.fallback, false);
  assert.equal(applyPlan(plan), target);
  assert.deepEqual(typedTexts(plan), [
    'int add(int a, int b) {',
    '\n    return a + b;',
    '\n}'
  ]);
});

test('blank lines fold into the following step', () => {
  const target = 'int x = 1;\n\nint y = 2;';
  const plan = makePlan('', target);
  assert.equal(applyPlan(plan), target);
  assert.deepEqual(typedTexts(plan), ['int x = 1;', '\n\nint y = 2;']);
});

test('in-line placeholder: only the differing middle is retyped', () => {
  const plan = makePlan('int x = ...;', 'int x = 42;');
  assert.equal(plan.fallback, false);
  assert.deepEqual(plan.steps, [
    {
      ops: [
        { kind: 'delete', from: 8, to: 11 },
        { kind: 'type', at: 8, text: '42' }
      ]
    }
  ]);
});

test('class grows attributes and methods in place', () => {
  const start = [
    'class Point {',
    'public:',
    '    Point(double x, double y) : x_{x}, y_{y} {}',
    '',
    'private:',
    '    double x_;',
    '    double y_;',
    '};'
  ].join('\n');
  const target = [
    'class Point {',
    'public:',
    '    Point(double x, double y) : x_{x}, y_{y} {}',
    '',
    '    double x() const { return x_; }',
    '    double y() const { return y_; }',
    '',
    'private:',
    '    double x_;',
    '    double y_;',
    '};'
  ].join('\n');
  const plan = makePlan(start, target);
  assert.equal(plan.fallback, false);
  assert.equal(applyPlan(plan), target);
  assert.ok(plan.steps.every(s => s.ops.every(o => o.kind === 'type')));
});

test('pass replaced by a multi-line body', () => {
  const start = 'def f(x):\n    pass\n';
  const target = 'def f(x):\n    y = x * 2\n    return y\n';
  const plan = makePlan(start, target);
  assert.equal(plan.fallback, false);
  assert.equal(applyPlan(plan), target);
});

test('deleted block and trailing lines', () => {
  for (const [s, t] of [
    ['a\nb\nc\nd', 'a\nd'],
    ['a\nb\nc', 'a'],
    ['a\nb\nc', 'c'],
    ['a\nb', ''],
    ['', ''],
    ['x', 'y\nx']
  ]) {
    const plan = makePlan(s, t);
    assert.equal(applyPlan(plan), t, JSON.stringify([s, t]));
  }
});

test('keystrokes keep newline + indentation together', () => {
  assert.deepEqual(keystrokes('a\n    b'), ['a', '\n    ', 'b']);
  assert.deepEqual(keystrokes('\n\n  x'), ['\n', '\n  ', 'x']);
});

test('fuzz: every plan replays to the target; fallback is rare', () => {
  let seed = 12345;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const vocab = ['int a;', '    a = 1;', '', '}', 'void f() {', '    // c', 'return 0;'];
  let fallbacks = 0;
  const runs = 2000;
  for (let r = 0; r < runs; r++) {
    const s = Array.from({ length: rand(8) }, () => vocab[rand(vocab.length)]).join('\n');
    const lines = s.split('\n');
    for (let e = rand(4); e >= 0; e--) {
      const op = rand(3);
      const pos = rand(lines.length + 1);
      if (op === 0) lines.splice(pos, 0, vocab[rand(vocab.length)]);
      else if (op === 1 && lines.length > 1) lines.splice(pos % lines.length, 1);
      else lines[pos % lines.length] += ' x';
    }
    const t = lines.join('\n');
    const plan = makePlan(s, t);
    assert.equal(applyPlan(plan), t, JSON.stringify([s, t]));
    if (plan.fallback) fallbacks++;
  }
  assert.ok(fallbacks / runs < 0.02, `fallback rate ${fallbacks / runs}`);
});
