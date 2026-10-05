/**
 * jupyterlab-clm-typing — spike.
 *
 * Replays the edit from a code-along cell to its completed version as
 * simulated typing. The target text comes from cell metadata
 * (`metadata.clm.typing.target`, optionally `.start`), which CLM would emit
 * for recording notebooks only.
 *
 * Edits are dispatched as CodeMirror transactions *without* an
 * `input.type` user-event annotation, so the editor's typing-triggered
 * behaviour (indent-on-input, bracket auto-close, completion popups) never
 * fires: the cell ends up with exactly the target text, with the
 * indentation the plan types.
 */
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { Notification } from '@jupyterlab/apputils';
import type { Cell } from '@jupyterlab/cells';
import type { CodeMirrorEditor } from '@jupyterlab/codemirror';
import { INotebookTracker } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import type { EditorView } from '@codemirror/view';

import { makePlan } from './planner.ts';
import { isRunCellChord, Player, type EditorPort } from './player.ts';

const PLUGIN_ID = 'jupyterlab-clm-typing:plugin';
const ARMED_CLASS = 'clm-typing-armed';

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

const DEFAULTS: Config = {
  mode: 'step',
  charsPerSecond: 22,
  jitter: 0.6,
  selectionPauseMs: 450,
  hackerMinChars: 1,
  hackerMaxChars: 1,
  showIndicator: true
};

interface TypingMeta {
  target: string;
  start?: string;
}

function readMeta(cell: Cell): TypingMeta | null {
  const clm = cell.model.getMetadata('clm') as
    | { typing?: Partial<TypingMeta> }
    | undefined;
  const t = clm?.typing;
  if (t && typeof t.target === 'string') {
    return { target: t.target, start: t.start };
  }
  return null;
}

/** EditorPort backed by the cell's CodeMirror 6 view. */
class ViewPort implements EditorPort {
  lastInserted = '';
  private cell: Cell;

  constructor(cell: Cell) {
    this.cell = cell;
  }

  private get view(): EditorView {
    return (this.cell.editor as CodeMirrorEditor).editor;
  }

  replace(from: number, to: number, text: string): void {
    this.lastInserted = text;
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true
    });
  }

  select(from: number, to: number): void {
    this.view.dispatch({
      selection: { anchor: from, head: to },
      scrollIntoView: true
    });
  }

  getText(): string {
    return this.view.state.doc.toString();
  }

  setText(text: string): void {
    const view = this.view;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length }
    });
  }
}

interface Session {
  cell: Cell;
  port: ViewPort;
  player: Player;
  animation: { cancelled: boolean } | null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));


const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description: 'Replay code-along -> completed edits as simulated typing.',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    settingRegistry: ISettingRegistry | null
  ) => {
    let config: Config = { ...DEFAULTS };
    let settings: ISettingRegistry.ISettings | null = null;
    const sessions = new Map<string, Session>();
    let armed: Session | null = null;

    if (settingRegistry) {
      void settingRegistry.load(PLUGIN_ID).then(s => {
        settings = s;
        const update = () => {
          config = { ...DEFAULTS, ...(s.composite as Partial<Config>) };
          if (config.mode !== 'hacker') {
            disarm();
          }
        };
        update();
        s.changed.connect(update);
      });
    }

    function newSession(cell: Cell, meta: TypingMeta): Session {
      const port = new ViewPort(cell);
      const plan = makePlan(port.getText(), meta.target);
      if (plan.fallback) {
        console.warn('clm-typing: heuristic plan failed, using retype fallback');
      }
      const session = { cell, port, player: new Player(plan, port), animation: null };
      sessions.set(cell.model.id, session);
      return session;
    }

    /** Session for the active cell, created on first use. */
    async function activeSession(): Promise<Session | null> {
      const panel = tracker.currentWidget;
      const cell = tracker.activeCell;
      if (!panel || !cell || cell.model.type !== 'code') {
        return null;
      }
      const meta = readMeta(cell);
      if (!meta) {
        Notification.warning('No typing plan in this cell', { autoClose: 1500 });
        return null;
      }
      if (!cell.editor) {
        await panel.content.scrollToCell(cell);
        await cell.ready;
      }
      const existing = sessions.get(cell.model.id);
      if (existing && existing.cell === cell) {
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

    function arm(s: Session): void {
      disarm();
      armed = s;
      if (config.showIndicator) {
        s.cell.node.classList.add(ARMED_CLASS);
      }
    }

    function disarm(): void {
      if (armed) {
        armed.cell.node.classList.remove(ARMED_CLASS);
        armed = null;
      }
    }

    function charDelay(port: ViewPort): number {
      const base = 1000 / Math.max(1, config.charsPerSecond);
      const j = Math.min(Math.max(config.jitter, 0), 0.95);
      let d = base * (1 + j * (Math.random() * 2 - 1));
      if (port.lastInserted.startsWith('\n')) {
        d *= 3; // a beat after Enter
      } else if (port.lastInserted === ' ') {
        d *= 1.3;
      }
      return d;
    }

    /** Step mode: type the next step; a second press flushes it. */
    async function stepAdvance(s: Session): Promise<void> {
      if (s.animation) {
        stopAnimation(s);
        s.player.finishStep();
        return;
      }
      if (s.player.done) {
        Notification.info('Cell already complete', { autoClose: 1000 });
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
          s.player.selectionPending ? config.selectionPauseMs : charDelay(s.port)
        );
        if (token.cancelled) {
          return;
        }
      }
      if (s.animation === token) {
        s.animation = null;
      }
    }

    // Hacker mode: while a cell is armed, every plain key press types the
    // next few characters of the script. Modifier chords pass through (so
    // Alt+N disarms, Ctrl+S saves); Esc disarms. Every run-cell chord
    // (Shift/Ctrl/Alt/Cmd+Enter) disarms and still reaches JupyterLab.
    const onKeydown = (event: KeyboardEvent) => {
      if (!armed) {
        return;
      }
      if (isRunCellChord(event)) {
        disarm(); // let JupyterLab run the cell
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        disarm();
        return;
      }
      // Once the script is exhausted the cell stays armed and swallows keys,
      // so over-typing at the end of a cell never leaks stray characters.
      // Shift+Enter (run), Esc or Alt+N end it.
      const s = armed;
      const lo = Math.max(1, config.hackerMinChars);
      const hi = Math.max(lo, config.hackerMaxChars);
      const n = lo + Math.floor(Math.random() * (hi - lo + 1));
      for (let i = 0; i < n; i++) {
        if (s.player.tick() === 'done') {
          break;
        }
        if (s.player.selectionPending) {
          break; // a selection gets its own key press
        }
      }
    };
    window.addEventListener('keydown', onKeydown, true);

    app.commands.addCommand('clm-typing:advance', {
      label: 'Typing replay: advance (step) / arm (hacker)',
      execute: async () => {
        const s = await activeSession();
        if (!s) {
          return;
        }
        s.cell.editor?.focus();
        if (config.mode === 'hacker') {
          if (armed === s) {
            disarm();
          } else if (s.player.done) {
            Notification.info('Cell already complete', { autoClose: 1000 });
          } else {
            arm(s);
          }
        } else {
          await stepAdvance(s);
        }
      }
    });

    app.commands.addCommand('clm-typing:finish', {
      label: 'Typing replay: finish cell now',
      execute: async () => {
        const s = await activeSession();
        if (s) {
          stopAnimation(s);
          s.player.finishAll();
          disarm();
        }
      }
    });

    app.commands.addCommand('clm-typing:undo-step', {
      label: 'Typing replay: undo last step',
      execute: async () => {
        const s = await activeSession();
        if (s) {
          stopAnimation(s);
          s.player.undoStep();
        }
      }
    });

    app.commands.addCommand('clm-typing:reset', {
      label: 'Typing replay: reset cell to its start',
      execute: async () => {
        const s = await activeSession();
        if (!s) {
          return;
        }
        stopAnimation(s);
        disarm();
        const meta = readMeta(s.cell);
        if (meta?.start !== undefined) {
          s.port.setText(meta.start);
          newSession(s.cell, meta);
        } else {
          s.player.reset();
        }
      }
    });

    app.commands.addCommand('clm-typing:toggle-mode', {
      label: 'Typing replay: toggle step/hacker mode',
      execute: async () => {
        const mode: Mode = config.mode === 'step' ? 'hacker' : 'step';
        if (settings) {
          await settings.set('mode', mode);
        } else {
          config.mode = mode;
        }
        Notification.info(`Typing replay mode: ${mode}`, { autoClose: 1200 });
      }
    });
  }
};

export default plugin;
