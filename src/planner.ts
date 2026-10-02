/**
 * Typing planner: turns a (start, target) pair of cell sources into a list of
 * human-like editing steps.
 *
 * Pure module — no JupyterLab imports — so it can be unit-tested with plain
 * Node (`node tests/planner.test.ts`).
 *
 * Model
 * -----
 * A plan is a list of *steps* (the unit a presenter advances in step mode),
 * each a list of *ops*. Op offsets are absolute character offsets in the
 * document as it is at the moment the op runs, i.e. after all earlier ops
 * have been applied in full. The planner simulates the document while
 * building the plan and verifies at the end that replaying the plan on
 * `start` yields exactly `target`; if it does not, it falls back to a
 * "select all and retype" plan, so a plan can never leave a wrong cell.
 *
 * Heuristics (V1, line-based):
 * - Lines are diffed with an LCS; each change hunk is processed top to bottom.
 * - Deleted and inserted lines in a hunk are paired up first. A paired line
 *   is edited in place: the common prefix/suffix stays, the differing middle
 *   is selected, deleted and retyped (`x = ...` -> `x = 42` selects `...`).
 * - Surplus deleted lines are removed as one selected block.
 * - Surplus inserted lines are typed one step per line, each starting with
 *   the newline ("press Enter, then type"), so the cursor rests at the end of
 *   the line just typed while the presenter talks. Blank lines are merged into
 *   the following line's step.
 */

export type Op =
  | { kind: 'type'; at: number; text: string }
  | { kind: 'delete'; from: number; to: number };

export interface Step {
  ops: Op[];
}

export interface Plan {
  start: string;
  target: string;
  steps: Step[];
  /** True if the heuristic plan failed verification and was replaced. */
  fallback: boolean;
}

/** Apply a single op to a document string. */
export function applyOp(doc: string, op: Op): string {
  if (op.kind === 'type') {
    return doc.slice(0, op.at) + op.text + doc.slice(op.at);
  }
  return doc.slice(0, op.from) + doc.slice(op.to);
}

/** Replay a whole plan on its start document. */
export function applyPlan(plan: Plan): string {
  let doc = plan.start;
  for (const step of plan.steps) {
    for (const op of step.ops) {
      doc = applyOp(doc, op);
    }
  }
  return doc;
}

/**
 * Split typed text into keystrokes. A newline together with the indentation
 * that follows it is one keystroke — that is what a human sees with
 * auto-indent: Enter, and the cursor lands indented.
 */
export function keystrokes(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\n') {
      let j = i + 1;
      while (j < text.length && (text[j] === ' ' || text[j] === '\t')) {
        j++;
      }
      out.push(text.slice(i, j));
      i = j;
    } else {
      out.push(text[i]);
      i++;
    }
  }
  return out;
}

type DiffEntry = { kind: 'same' | 'del' | 'ins'; line: string };

function diffLines(a: string[], b: string[]): DiffEntry[] {
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i:], b[j:]
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: 'same', line: a[i] });
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      out.push({ kind: 'ins', line: b[j] });
      j++;
    } else {
      out.push({ kind: 'del', line: a[i] });
      i++;
    }
  }
  return out;
}

/** Mutable simulated document, addressed by lines. */
class SimDoc {
  text: string;

  constructor(text: string) {
    this.text = text;
  }

  get lines(): string[] {
    return this.text.split('\n');
  }

  /** Offset of the start of line `i` (0-based). */
  lineStart(i: number): number {
    const lines = this.lines;
    let off = 0;
    for (let k = 0; k < i; k++) {
      off += lines[k].length + 1;
    }
    return off;
  }

  lineEnd(i: number): number {
    return this.lineStart(i) + this.lines[i].length;
  }

  apply(op: Op): Op {
    this.text = applyOp(this.text, op);
    return op;
  }
}

function commonPrefix(a: string, b: string): number {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) {
    k++;
  }
  return k;
}

function commonSuffix(a: string, b: string, prefix: number): number {
  let k = 0;
  while (
    k < a.length - prefix &&
    k < b.length - prefix &&
    a[a.length - 1 - k] === b[b.length - 1 - k]
  ) {
    k++;
  }
  return k;
}

function heuristicPlan(start: string, target: string): Step[] {
  if (start === '') {
    return typeFresh(target);
  }
  const doc = new SimDoc(start);
  const steps: Step[] = [];
  const diff = diffLines(start.split('\n'), target.split('\n'));

  // `line` is the index, in the *current* simulated doc, of the next
  // unprocessed original line.
  let line = 0;
  let k = 0;
  while (k < diff.length) {
    if (diff[k].kind === 'same') {
      line++;
      k++;
      continue;
    }
    const dels: string[] = [];
    const ins: string[] = [];
    while (k < diff.length && diff[k].kind !== 'same') {
      (diff[k].kind === 'del' ? dels : ins).push(diff[k].line);
      k++;
    }

    // 1. Paired lines: edit in place.
    const paired = Math.min(dels.length, ins.length);
    for (let p = 0; p < paired; p++) {
      const old = dels[p];
      const neu = ins[p];
      const pre = commonPrefix(old, neu);
      const suf = commonSuffix(old, neu, pre);
      const base = doc.lineStart(line);
      const ops: Op[] = [];
      if (old.length - pre - suf > 0) {
        ops.push(
          doc.apply({
            kind: 'delete',
            from: base + pre,
            to: base + old.length - suf
          })
        );
      }
      const middle = neu.slice(pre, neu.length - suf);
      if (middle.length > 0) {
        ops.push(doc.apply({ kind: 'type', at: base + pre, text: middle }));
      }
      if (ops.length > 0) {
        steps.push({ ops });
      }
      line++;
    }

    // 2. Surplus deleted lines: remove as one block.
    const surplusDel = dels.length - paired;
    if (surplusDel > 0) {
      const total = doc.lines.length;
      let from: number;
      let to: number;
      if (line + surplusDel < total) {
        from = doc.lineStart(line);
        to = doc.lineStart(line + surplusDel);
      } else if (line > 0) {
        from = doc.lineEnd(line - 1);
        to = doc.text.length;
      } else {
        from = 0;
        to = doc.text.length;
      }
      steps.push({ ops: [doc.apply({ kind: 'delete', from, to })] });
    }

    // 3. Surplus inserted lines: "Enter, then type", one step per line.
    let pending = '';
    for (let p = paired; p < ins.length; p++) {
      const text = ins[p];
      const isLast = p === ins.length - 1;
      if (line > 0) {
        pending += '\n' + text;
        if (text.trim() === '' && !isLast) {
          continue; // blank line: fold into the next line's step
        }
        const at = doc.lineEnd(line - 1);
        steps.push({ ops: [doc.apply({ kind: 'type', at, text: pending })] });
        line += countNewlines(pending);
        pending = '';
      } else {
        // Inserting before the first line: type it, then Enter.
        steps.push({
          ops: [doc.apply({ kind: 'type', at: 0, text: text + '\n' })]
        });
        line++;
      }
    }
  }
  return steps;
}

function countNewlines(s: string): number {
  let n = 0;
  for (const c of s) {
    if (c === '\n') {
      n++;
    }
  }
  return n;
}

/** Steps that type `target` into an empty document, one line per step. */
function typeFresh(target: string): Step[] {
  const steps: Step[] = [];
  const lines = target.split('\n');
  let at = 0;
  let pending = '';
  lines.forEach((line, idx) => {
    pending += (idx === 0 ? '' : '\n') + line;
    // Blank lines fold forward into the next non-blank line's step.
    if (line.trim() !== '' || idx === lines.length - 1) {
      if (pending.length > 0) {
        steps.push({ ops: [{ kind: 'type', at, text: pending }] });
        at += pending.length;
      }
      pending = '';
    }
  });
  return steps;
}

function fallbackPlan(start: string, target: string): Step[] {
  const steps: Step[] = [];
  if (start.length > 0) {
    steps.push({ ops: [{ kind: 'delete', from: 0, to: start.length }] });
  }
  return steps.concat(typeFresh(target));
}

export function makePlan(start: string, target: string): Plan {
  const plan: Plan = {
    start,
    target,
    steps: heuristicPlan(start, target),
    fallback: false
  };
  if (applyPlan(plan) === target) {
    return plan;
  }
  return { start, target, steps: fallbackPlan(start, target), fallback: true };
}
