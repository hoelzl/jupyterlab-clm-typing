// Runs inside the VS Code extension host (see run.ts). No test framework:
// each case is an async function; failures are collected and rethrown.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as vscode from 'vscode';

const FIZZBUZZ = 1; // empty start
const AREA = 2; // start -> target edit

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitFor(what: string, cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await sleep(20);
  }
}

function typingOf(cell: vscode.NotebookCell): { start: string; target: string } {
  return (cell.metadata as any).metadata.clm.typing;
}

const text = (cell: vscode.NotebookCell) =>
  cell.document.getText().replace(/\r\n/g, '\n');

async function configure(values: Record<string, unknown>): Promise<void> {
  const c = vscode.workspace.getConfiguration('clmTyping');
  for (const [k, v] of Object.entries(values)) {
    await c.update(k, v, vscode.ConfigurationTarget.Global);
  }
}

async function open(name: string): Promise<vscode.NotebookEditor> {
  const root = vscode.workspace.workspaceFolders![0].uri;
  const doc = await vscode.workspace.openNotebookDocument(
    vscode.Uri.joinPath(root, name)
  );
  return vscode.window.showNotebookDocument(doc);
}

async function focusCell(nb: vscode.NotebookEditor, index: number): Promise<vscode.NotebookCell> {
  nb.selection = new vscode.NotebookRange(index, index + 1);
  await vscode.commands.executeCommand('notebook.cell.edit');
  const cell = nb.notebook.cellAt(index);
  await waitFor(
    `editor of cell ${index}`,
    () => vscode.window.activeTextEditor?.document === cell.document
  );
  return cell;
}

/** Advance in step mode until the cell is complete; returns the snapshots. */
async function stepThrough(cell: vscode.NotebookCell): Promise<string[]> {
  const seen = [text(cell)];
  for (let i = 0; i < 100 && text(cell) !== typingOf(cell).target; i++) {
    await vscode.commands.executeCommand('clmTyping.advance');
    seen.push(text(cell));
  }
  return seen;
}

const cases: Record<string, () => Promise<void>> = {
  async 'step mode types an empty cell line by line'() {
    await configure({ mode: 'step', charsPerSecond: 2000, jitter: 0, selectionPauseMs: 1 });
    const nb = await open('typing_py.ipynb');
    const cell = await focusCell(nb, FIZZBUZZ);
    const seen = await stepThrough(cell);
    assert.equal(text(cell), typingOf(cell).target);
    assert.equal(seen[1], 'def fizzbuzz(n):');
    assert.equal(seen[2], 'def fizzbuzz(n):\n    for i in range(1, n + 1):');
    assert.equal(seen.length, 9, 'one step per line');
  },

  async 'step mode edits start -> target; undo, finish, reset'() {
    await configure({ mode: 'step' });
    const nb = await open('typing_py.ipynb');
    const cell = await focusCell(nb, AREA);
    const { start, target } = typingOf(cell);
    assert.equal(text(cell), start);
    const seen = await stepThrough(cell);
    assert.equal(text(cell), target);
    await vscode.commands.executeCommand('clmTyping.undoStep');
    assert.equal(text(cell), seen[seen.length - 2]);
    await vscode.commands.executeCommand('clmTyping.finish');
    assert.equal(text(cell), target);
    await vscode.commands.executeCommand('clmTyping.reset');
    assert.equal(text(cell), start);
  },

  async 'hacker mode: keys type the script and never leak'() {
    await configure({ mode: 'hacker', hackerMinChars: 1, hackerMaxChars: 3 });
    const nb = await open('typing_py.ipynb');
    const cell = await focusCell(nb, FIZZBUZZ);
    await vscode.commands.executeCommand('clmTyping.reset');
    assert.equal(text(cell), '');
    await vscode.commands.executeCommand('clmTyping.advance'); // arm
    const target = typingOf(cell).target;
    for (let i = 0; i < 1000 && text(cell) !== target; i++) {
      await vscode.commands.executeCommand('type', { text: 'z' });
      if (i % 10 === 0) {
        await vscode.commands.executeCommand('clmTyping.hackerKey'); // e.g. Enter
      }
      await sleep(1);
    }
    await waitFor('hacker typing to finish', () => text(cell) === target);
    // Over-typing past the end is swallowed.
    for (let i = 0; i < 20; i++) {
      await vscode.commands.executeCommand('type', { text: 'z' });
    }
    await sleep(200);
    assert.equal(text(cell), target);
    // Disarm gives the keyboard back: `type` reaches the editor again.
    await vscode.commands.executeCommand('clmTyping.disarm');
    await vscode.commands.executeCommand('type', { text: 'z' });
    await waitFor('default typing after disarm', () => text(cell) === target + 'z');
  },

  async 'hacker mode: leaving the cell disarms'() {
    const nb = await open('typing_py.ipynb');
    const cell = await focusCell(nb, AREA);
    await vscode.commands.executeCommand('clmTyping.reset');
    await vscode.commands.executeCommand('clmTyping.advance'); // arm
    await vscode.commands.executeCommand('type', { text: 'z' });
    await sleep(200);
    const afterOne = text(cell);
    assert.notEqual(afterOne, typingOf(cell).start, 'armed key typed the script');
    assert.ok(!afterOne.includes('z'));
    const other = await focusCell(nb, FIZZBUZZ);
    await vscode.commands.executeCommand('type', { text: 'q' });
    await waitFor('q typed into the other cell', () => text(other).endsWith('q'));
    assert.equal(text(cell), afterOne, 'armed cell untouched');
  },

  async 'CRLF documents (files.eol = \\r\\n)'() {
    await vscode.workspace
      .getConfiguration('files')
      .update('eol', '\r\n', vscode.ConfigurationTarget.Global);
    const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
    fs.copyFileSync(`${root}/typing_py.ipynb`, `${root}/typing_crlf.ipynb`);
    await configure({ mode: 'step' });
    const nb = await open('typing_crlf.ipynb');
    const cell = await focusCell(nb, AREA);
    console.log(`    cell document eol: ${cell.document.eol === vscode.EndOfLine.CRLF ? 'CRLF' : 'LF'}`);
    await stepThrough(cell);
    assert.equal(text(cell), typingOf(cell).target);
  }
};

export async function run(): Promise<void> {
  const ext = vscode.extensions.all.find(e => e.packageJSON.name === 'clm-typing');
  await ext?.activate();
  const failures: string[] = [];
  for (const [name, fn] of Object.entries(cases)) {
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (err) {
      console.log(`  FAIL ${name}\n       ${String((err as Error).stack ?? err)}`);
      failures.push(name);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} integration case(s) failed`);
  }
}
