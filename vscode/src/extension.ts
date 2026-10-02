/**
 * clm-typing for VS Code — spike.
 *
 * Replays the edit from a CLM code-along cell to its completed version as
 * simulated typing, using the same planner and player as the JupyterLab
 * extension (`../../src/planner.ts`, `../../src/player.ts`).
 *
 * Edits are applied with `TextEditor.edit()` on the cell's editor. Auto-close
 * brackets, on-Enter indentation, format-on-type and the suggest widget are
 * all triggered by the `type` command (real typing), never by programmatic
 * edits, so the cell ends with exactly the target text and the indentation
 * the plan types.
 *
 * Hacker mode takes over the `type` command while a cell is armed (the
 * mechanism VSCodeVim uses), and gives it back on disarm.
 */
import * as vscode from 'vscode';

import { makePlan } from '../../src/planner.ts';
import { Player, type EditorPort } from '../../src/player.ts';
import {
  charDelay,
  hackerBurst,
  lineCol,
  minimalEdit,
  normalizeEol,
  readTyping,
  type TypingMeta
} from './core.ts';

type Mode = 'step' | 'hacker';

interface Config {
  mode: Mode;
  charsPerSecond: number;
  jitter: number;
  selectionPauseMs: number;
  hackerMinChars: number;
  hackerMaxChars: number;
  showIndicator: boolean;
}

function readConfig(): Config {
  const c = vscode.workspace.getConfiguration('clmTyping');
  return {
    mode: c.get<Mode>('mode', 'step'),
    charsPerSecond: c.get('charsPerSecond', 22),
    jitter: c.get('jitter', 0.6),
    selectionPauseMs: c.get('selectionPauseMs', 450),
    hackerMinChars: c.get('hackerMinChars', 1),
    hackerMaxChars: c.get('hackerMaxChars', 3),
    showIndicator: c.get('showIndicator', true)
  };
}

let log: vscode.OutputChannel;

function toPosition(text: string, offset: number): vscode.Position {
  const { line, character } = lineCol(text, offset);
  return new vscode.Position(line, character);
}

/**
 * EditorPort backed by a notebook cell.
 *
 * The player is synchronous; VS Code edits are not. The port therefore keeps
 * the *desired* state (text + selection) and a single flush loop converges
 * the cell's editor to it, one `edit()` at a time. Ticks that arrive while an
 * edit is in flight are coalesced into the next edit, so fast key presses in
 * hacker mode can never apply out of order.
 */
class CellPort implements EditorPort {
  lastInserted = '';
  readonly cell: vscode.NotebookCell;
  private text: string;
  private anchor = 0;
  private head = 0;
  private dirty = false;
  private running: Promise<void> | null = null;

  constructor(cell: vscode.NotebookCell) {
    this.cell = cell;
    this.text = normalizeEol(cell.document.getText());
  }

  replace(from: number, to: number, text: string): void {
    this.lastInserted = text;
    this.text = this.text.slice(0, from) + text + this.text.slice(to);
    this.anchor = this.head = from + text.length;
    this.schedule();
  }

  select(from: number, to: number): void {
    this.anchor = from;
    this.head = to;
    this.schedule();
  }

  getText(): string {
    return this.text;
  }

  setText(text: string): void {
    this.text = text;
    this.anchor = this.head = text.length;
    this.schedule();
  }

  /** Resolves once the editor shows the desired state. */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /** Adopt the document's real text (it may have been edited by hand). */
  async sync(): Promise<void> {
    await this.idle();
    this.text = normalizeEol(this.cell.document.getText());
  }

  private schedule(): void {
    this.dirty = true;
    if (!this.running) {
      this.running = this.loop();
    }
  }

  private async loop(): Promise<void> {
    let failures = 0;
    try {
      while (this.dirty) {
        this.dirty = false;
        if (!(await this.flush())) {
          // The document changed under us (e.g. a key press that got
          // through); retry against its new version a few times.
          if (++failures > 5) {
            log.appendLine('edit rejected repeatedly; giving up this flush');
            break;
          }
          this.dirty = true;
        }
      }
    } catch (err) {
      log.appendLine(`flush failed: ${String(err)}`);
    } finally {
      // No await between the last `dirty` check and here, so a tick cannot
      // slip in and find a stale `running` promise.
      this.running = null;
    }
  }

  private async flush(): Promise<boolean> {
    const doc = this.cell.document;
    const desired = this.text;
    const editor = vscode.window.visibleTextEditors.find(
      e => e.document === doc
    );
    const current = normalizeEol(doc.getText());
    const edit = minimalEdit(current, desired);
    if (edit) {
      const range = new vscode.Range(
        toPosition(current, edit.from),
        toPosition(current, edit.to)
      );
      if (editor) {
        const ok = await editor.edit(b => b.replace(range, edit.text), {
          undoStopBefore: false,
          undoStopAfter: false
        });
        if (!ok) {
          return false;
        }
      } else {
        const we = new vscode.WorkspaceEdit();
        we.replace(doc.uri, range, edit.text);
        if (!(await vscode.workspace.applyEdit(we))) {
          return false;
        }
      }
    }
    if (editor && this.text === desired) {
      const sel = new vscode.Selection(
        toPosition(desired, this.anchor),
        toPosition(desired, this.head)
      );
      editor.selection = sel;
      editor.revealRange(
        sel,
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
      );
    }
    return true;
  }
}

interface Session {
  cell: vscode.NotebookCell;
  port: CellPort;
  player: Player;
  animation: { cancelled: boolean } | null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const isCellDoc = (doc: vscode.TextDocument | undefined) =>
  doc?.uri.scheme === 'vscode-notebook-cell';

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel('CLM Typing');
  let config = readConfig();
  const sessions = new Map<string, Session>();
  let armed: Session | null = null;
  let typeHook: vscode.Disposable | null = null;

  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    1000
  );
  status.text = '$(keyboard) armed';
  status.tooltip = 'CLM typing: hacker mode armed (Esc or Alt+N disarms)';
  const armedDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground')
  });
  context.subscriptions.push(log, status, armedDecoration);

  const flash = (msg: string) =>
    vscode.window.setStatusBarMessage(`CLM typing: ${msg}`, 1500);

  function newSession(cell: vscode.NotebookCell, meta: TypingMeta): Session {
    const port = new CellPort(cell);
    const plan = makePlan(port.getText(), meta.target);
    if (plan.fallback) {
      log.appendLine(
        `cell ${cell.index}: heuristic plan failed, using retype fallback`
      );
    }
    const session: Session = {
      cell,
      port,
      player: new Player(plan, port),
      animation: null
    };
    sessions.set(cell.document.uri.toString(), session);
    return session;
  }

  /** Wait (briefly) until `doc` is the active text editor's document. */
  async function waitForEditor(doc: vscode.TextDocument): Promise<boolean> {
    for (let i = 0; i < 40; i++) {
      if (vscode.window.activeTextEditor?.document === doc) {
        return true;
      }
      await sleep(25);
    }
    return false;
  }

  /** Session for the active cell, created on first use. */
  async function activeSession(): Promise<Session | null> {
    const nb = vscode.window.activeNotebookEditor;
    if (!nb) {
      flash('no active notebook');
      return null;
    }
    // The notebook selection follows the focused cell in both command and
    // edit mode; the active text editor is only a fallback.
    let cell: vscode.NotebookCell | undefined;
    if (!nb.selection.isEmpty && nb.selection.start < nb.notebook.cellCount) {
      cell = nb.notebook.cellAt(nb.selection.start);
    } else {
      const te = vscode.window.activeTextEditor;
      if (te && isCellDoc(te.document)) {
        cell = nb.notebook.getCells().find(c => c.document === te.document);
      }
    }
    if (!cell || cell.kind !== vscode.NotebookCellKind.Code) {
      flash('no code cell selected');
      return null;
    }
    const meta = readTyping(cell.metadata);
    if (!meta) {
      flash('no typing plan in this cell');
      return null;
    }
    if (vscode.window.activeTextEditor?.document !== cell.document) {
      // Enter edit mode so the cell has an editor to show selections in.
      await vscode.commands.executeCommand('notebook.cell.edit');
      if (!(await waitForEditor(cell.document))) {
        log.appendLine(`cell ${cell.index}: no editor; typing without one`);
      }
    }
    const existing = sessions.get(cell.document.uri.toString());
    if (existing) {
      if (!existing.animation) {
        await existing.port.sync();
      }
      return existing;
    }
    return newSession(cell, meta);
  }

  function stopAnimation(s: Session): void {
    if (s.animation) {
      s.animation.cancelled = true;
      s.animation = null;
    }
  }

  function showArmed(s: Session | null): void {
    for (const e of vscode.window.visibleTextEditors) {
      e.setDecorations(armedDecoration, []);
    }
    if (!s || !config.showIndicator) {
      status.hide();
      return;
    }
    status.show();
    const editor = vscode.window.visibleTextEditors.find(
      e => e.document === s.cell.document
    );
    editor?.setDecorations(armedDecoration, [
      new vscode.Range(0, 0, Math.max(0, s.cell.document.lineCount - 1), 0)
    ]);
  }

  function arm(s: Session): void {
    disarm();
    try {
      typeHook = vscode.commands.registerCommand('type', onType);
    } catch (err) {
      vscode.window.showErrorMessage(
        "CLM typing: hacker mode needs VS Code's 'type' command, but another " +
          'extension (e.g. Vim) owns it. Disable that extension for recording.'
      );
      log.appendLine(`registerCommand('type') failed: ${String(err)}`);
      return;
    }
    armed = s;
    void vscode.commands.executeCommand('setContext', 'clmTyping.armed', true);
    showArmed(s);
  }

  function disarm(): void {
    typeHook?.dispose();
    typeHook = null;
    if (armed) {
      armed = null;
      void vscode.commands.executeCommand(
        'setContext',
        'clmTyping.armed',
        false
      );
      showArmed(null);
    }
  }

  /**
   * Hacker mode: one real key press types the next few script keystrokes.
   * Once the script is exhausted the cell stays armed and keeps swallowing
   * keys, so over-typing at the end never leaks characters into it.
   */
  function hackerKey(): void {
    const s = armed;
    if (!s) {
      return;
    }
    const n = hackerBurst(config.hackerMinChars, config.hackerMaxChars);
    for (let i = 0; i < n; i++) {
      if (s.player.tick() === 'done') {
        break;
      }
      if (s.player.selectionPending) {
        break; // a selection gets its own key press
      }
    }
  }

  function onType(args: { text?: string }): Thenable<unknown> | void {
    const te = vscode.window.activeTextEditor;
    if (!armed || te?.document !== armed.cell.document) {
      // Typing anywhere else: give the keyboard back.
      disarm();
      return vscode.commands.executeCommand('default:type', args);
    }
    hackerKey();
  }

  /** Step mode: type the next step; a second press flushes it. */
  async function stepAdvance(s: Session): Promise<void> {
    if (s.animation) {
      stopAnimation(s);
      s.player.finishStep();
      return;
    }
    if (s.player.done) {
      flash('cell already complete');
      return;
    }
    const token = { cancelled: false };
    s.animation = token;
    for (;;) {
      const r = s.player.tick();
      if (r !== 'continue') {
        break;
      }
      await sleep(
        s.player.selectionPending
          ? config.selectionPauseMs
          : charDelay(config.charsPerSecond, config.jitter, s.port.lastInserted)
      );
      if (token.cancelled) {
        return;
      }
    }
    if (s.animation === token) {
      s.animation = null;
    }
  }

  const command = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  command('clmTyping.advance', async () => {
    if (armed && config.mode === 'hacker') {
      disarm(); // Alt+N toggles; no need to look up the cell
      return;
    }
    const s = await activeSession();
    if (!s) {
      return;
    }
    if (config.mode === 'hacker') {
      if (s.player.done) {
        flash('cell already complete');
      } else {
        arm(s);
      }
    } else {
      await stepAdvance(s);
      await s.port.idle();
    }
  });

  command('clmTyping.finish', async () => {
    const s = await activeSession();
    if (s) {
      stopAnimation(s);
      disarm();
      await s.port.sync();
      s.player.finishAll();
      await s.port.idle();
    }
  });

  command('clmTyping.undoStep', async () => {
    const s = await activeSession();
    if (s) {
      stopAnimation(s);
      s.player.undoStep();
      await s.port.idle();
    }
  });

  command('clmTyping.reset', async () => {
    const s = await activeSession();
    if (!s) {
      return;
    }
    stopAnimation(s);
    disarm();
    const meta = readTyping(s.cell.metadata);
    if (meta?.start !== undefined) {
      s.port.setText(meta.start);
      await s.port.idle();
      newSession(s.cell, meta);
    } else {
      s.player.reset();
      await s.port.idle();
    }
  });

  command('clmTyping.toggleMode', async () => {
    const mode: Mode = config.mode === 'step' ? 'hacker' : 'step';
    await vscode.workspace
      .getConfiguration('clmTyping')
      .update('mode', mode, vscode.ConfigurationTarget.Global);
    flash(`mode ${mode}`);
  });

  command('clmTyping.disarm', () => disarm());

  // Keys that do not go through `type` (Enter, Backspace, Tab, arrows, ...)
  // are bound to this while armed (see package.json), so they type the
  // script instead of editing the cell.
  command('clmTyping.hackerKey', () => hackerKey());

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('clmTyping')) {
        config = readConfig();
        if (config.mode !== 'hacker') {
          disarm();
        }
        showArmed(armed);
      }
    }),
    // Leaving the cell (Shift+Enter moves on, a click elsewhere, Esc to
    // command mode) disarms, so the keyboard is never captured by a cell
    // the presenter is not looking at.
    vscode.window.onDidChangeActiveTextEditor(e => {
      if (armed && e?.document !== armed.cell.document) {
        disarm();
      }
    }),
    // Running the armed cell (any run chord, or the run button) disarms.
    vscode.workspace.onDidChangeNotebookDocument(e => {
      if (
        armed &&
        e.cellChanges.some(
          c => c.cell === armed?.cell && c.executionSummary !== undefined
        )
      ) {
        disarm();
      }
    }),
    vscode.workspace.onDidCloseNotebookDocument(nb => {
      for (const cell of nb.getCells()) {
        sessions.delete(cell.document.uri.toString());
      }
      if (armed && armed.cell.notebook === nb) {
        disarm();
      }
    }),
    { dispose: disarm }
  );
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
