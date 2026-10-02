/**
 * Plan player: executes a typing plan one "keystroke" at a time against an
 * abstract editor port. Both presentation modes drive the same player:
 *
 * - step mode calls `tick()` on a timer until a step ends;
 * - hacker mode calls `tick()` a few times per real key press.
 *
 * Pure module (no JupyterLab imports) so it is testable with plain Node.
 */
import { keystrokes, type Plan } from './planner.ts';

export interface EditorPort {
  /** Replace [from, to) with `text` and put the cursor after it. */
  replace(from: number, to: number, text: string): void;
  /** Select [from, to). */
  select(from: number, to: number): void;
  getText(): string;
  /** Replace the whole document (used for undo/reset/finish recovery). */
  setText(text: string): void;
}

export type TickResult = 'continue' | 'step-end' | 'done';

export class Player {
  readonly plan: Plan;
  private port: EditorPort;
  private si = 0; // step index
  private oi = 0; // op index within the step
  private ki = 0; // keystroke index within a type op
  private selected = false; // delete op: selection shown, deletion pending
  private snapshots: string[] = []; // document text before step i
  private strokes = new Map<string, string[]>();

  constructor(plan: Plan, port: EditorPort) {
    this.plan = plan;
    this.port = port;
  }

  get done(): boolean {
    return this.si >= this.plan.steps.length;
  }

  get stepIndex(): number {
    return this.si;
  }

  /** True if the current step has been started but not finished. */
  get midStep(): boolean {
    return this.oi > 0 || this.ki > 0 || this.selected;
  }

  /** Whether the last tick left a selection that the next tick deletes. */
  get selectionPending(): boolean {
    return this.selected;
  }

  tick(): TickResult {
    if (this.done) {
      return 'done';
    }
    if (!this.midStep && this.snapshots.length === this.si) {
      this.snapshots.push(this.port.getText());
    }
    const op = this.plan.steps[this.si].ops[this.oi];
    if (op.kind === 'delete') {
      if (!this.selected) {
        this.port.select(op.from, op.to);
        this.selected = true;
        return 'continue';
      }
      this.port.replace(op.from, op.to, '');
      this.selected = false;
      return this.advanceOp();
    }
    const ks = this.keystrokesOf(op.text);
    let offset = op.at;
    for (let k = 0; k < this.ki; k++) {
      offset += ks[k].length;
    }
    this.port.replace(offset, offset, ks[this.ki]);
    this.ki++;
    if (this.ki < ks.length) {
      return 'continue';
    }
    return this.advanceOp();
  }

  /** Run the current step to its end without delay. */
  finishStep(): void {
    while (this.tick() === 'continue') {
      /* keep going */
    }
  }

  /** Run the whole plan to the end and make sure the target is reached. */
  finishAll(): void {
    while (this.tick() !== 'done') {
      /* keep going */
    }
    if (this.port.getText() !== this.plan.target) {
      // Someone edited the cell by hand mid-plan; land on the target anyway.
      this.port.setText(this.plan.target);
    }
  }

  /**
   * Undo the step in progress, or — at a step boundary — the last completed
   * step. Returns false if there is nothing to undo.
   */
  undoStep(): boolean {
    if (!this.midStep) {
      if (this.si === 0) {
        return false;
      }
      this.si--;
    }
    this.port.setText(this.snapshots[this.si]);
    this.snapshots.length = this.si;
    this.oi = 0;
    this.ki = 0;
    this.selected = false;
    return true;
  }

  reset(): void {
    this.port.setText(this.plan.start);
    this.si = 0;
    this.oi = 0;
    this.ki = 0;
    this.selected = false;
    this.snapshots = [];
  }

  private advanceOp(): TickResult {
    this.oi++;
    this.ki = 0;
    if (this.oi < this.plan.steps[this.si].ops.length) {
      return 'continue';
    }
    this.si++;
    this.oi = 0;
    return this.done ? 'done' : 'step-end';
  }

  private keystrokesOf(text: string): string[] {
    let ks = this.strokes.get(text);
    if (!ks) {
      ks = keystrokes(text);
      this.strokes.set(text, ks);
    }
    return ks;
  }
}
