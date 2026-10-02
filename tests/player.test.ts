// Run with: node --test tests/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePlan } from '../src/planner.ts';
import { Player, type EditorPort } from '../src/player.ts';

class FakeEditor implements EditorPort {
  text: string;
  selection: [number, number] = [0, 0];
  constructor(text: string) {
    this.text = text;
  }
  replace(from: number, to: number, text: string): void {
    this.text = this.text.slice(0, from) + text + this.text.slice(to);
    const end = from + text.length;
    this.selection = [end, end];
  }
  select(from: number, to: number): void {
    this.selection = [from, to];
  }
  getText(): string {
    return this.text;
  }
  setText(text: string): void {
    this.text = text;
  }
}

const START = 'class A {\n    int x = ...;\n};';
const TARGET = 'class A {\n    int x = 42;\n\n    int get() const { return x; }\n};';

test('ticking to the end yields the target, step by step', () => {
  const ed = new FakeEditor(START);
  const player = new Player(makePlan(START, TARGET), ed);
  let steps = 0;
  let r;
  while ((r = player.tick()) !== 'done') {
    if (r === 'step-end') steps++;
  }
  assert.equal(ed.text, TARGET);
  assert.equal(steps + 1, player.plan.steps.length);
});

test('delete shows a selection before removing it', () => {
  const ed = new FakeEditor(START);
  const player = new Player(makePlan(START, TARGET), ed);
  player.tick();
  assert.ok(player.selectionPending);
  assert.equal(ed.text.slice(...ed.selection), '...');
  player.tick();
  assert.equal(ed.text, 'class A {\n    int x = ;\n};');
});

test('undo mid-step and at a boundary restores snapshots', () => {
  const ed = new FakeEditor(START);
  const player = new Player(makePlan(START, TARGET), ed);
  player.finishStep();
  const afterStep1 = ed.text;
  player.tick(); // into step 2
  assert.ok(player.undoStep());
  assert.equal(ed.text, afterStep1);
  assert.ok(player.undoStep());
  assert.equal(ed.text, START);
  assert.equal(player.undoStep(), false);
  player.finishAll();
  assert.equal(ed.text, TARGET);
});

test('finishAll recovers from manual edits', () => {
  const ed = new FakeEditor(START);
  const player = new Player(makePlan(START, TARGET), ed);
  player.tick();
  ed.text = 'garbage';
  player.finishAll();
  assert.equal(ed.text, TARGET);
});
