# CLM Typing Replay for VS Code (spike)

The VS Code player for the JupyterLab extension in the parent directory. It replays
the edit from a CLM code-along cell to its completed version as simulated typing,
for recording videos. It reads the same cell metadata (`metadata.clm.typing.target`,
optional `.start`), which clm writes into `recording-code-along` notebooks only.

The planner and player are **shared** with the JupyterLab extension: `src/extension.ts`
imports `../../src/planner.ts` and `../../src/player.ts`, and esbuild bundles them in.
Only the editor side is VS Code specific.

## Install

```bash
cd vscode
npm install
npm run package                     # -> clm-typing-0.1.0.vsix
code --install-extension clm-typing-0.1.0.vsix
```

For development, open `vscode/` in VS Code and press F5 (or run
`code --extensionDevelopmentPath=<path-to>/vscode ../examples/typing_py.ipynb`).

## Use

| Key | Command |
|---|---|
| `Alt+N` | step: type the next line (press again mid-line to finish it); hacker: arm/disarm the cell |
| `Alt+Shift+N` | finish the cell now |
| `Alt+Shift+U` | undo the last step |
| `Alt+Shift+R` | reset the cell to its start |
| `Alt+Shift+M` | toggle step/hacker mode |
| `Esc` | disarm (hacker mode) |

Settings are under *CLM Typing Replay* (`clmTyping.*`), with the same names and
defaults as the JupyterLab extension.

## How it works

- **Programmatic edits, not key events.** The player edits the cell with
  `TextEditor.edit()`. Auto-closing brackets, on-Enter indentation, format-on-type and
  the suggest widget only react to real typing (the `type` command), so the cell
  always ends with exactly the target text.
- **Async editor, sync player.** `CellPort` keeps the desired text and selection and a
  single flush loop applies them to the editor one `edit()` at a time. Ticks that
  arrive during an edit are coalesced into the next one, so fast key presses can
  never apply out of order. Offsets become line/column positions on `\n` text, so
  `\r\n` documents work as well.
- **Hacker mode** registers VS Code's `type` command while a cell is armed (the same
  mechanism VSCodeVim uses) and disposes it on disarm. Keys that bypass `type`
  (Enter, Backspace, Delete, Tab, arrows, Home/End, PageUp/PageDown) are bound to the
  script while armed. Leaving the cell (Shift+Enter, Ctrl+Enter, a click elsewhere) or
  running it disarms; typing in another editor disarms and goes through normally.

## Tests

```bash
npm test                  # pure helpers (node --test)
npm run typecheck
npm run test:integration  # downloads VS Code into .vscode-test/ and runs tests/integration/suite.ts
```

The integration suite opens `../examples/typing_py.ipynb` in a real VS Code, steps
both cells in step mode (including undo, finish and reset), types a whole cell in
hacker mode through the `type` command and checks that over-typing does not leak,
that disarming gives the keyboard back, that focusing another cell disarms, and that
a `files.eol = \r\n` setup works.

## Recording setup notes

- **Turn off inline completions** (Copilot ghost text, `editor.inlineSuggest.enabled`)
  in the recording profile. They react to any document change, including programmatic
  ones, and would show grey suggestions on video.
- **VSCodeVim** (or any extension that owns `type`) and hacker mode exclude each
  other; arming shows an error if `type` is taken. Step mode is unaffected.
