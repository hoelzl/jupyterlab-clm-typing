# jupyterlab-clm-typing (spike)

Replays the edit from a CLM code-along cell to its completed version as
simulated typing, for recording videos. The target text comes from cell metadata
(`metadata.clm.typing.target`, optional `.start` for reset), which CLM would
emit for **recording** notebooks only.

## How it works

- **No synthetic key events.** Edits go into the cell's CodeMirror 6 view as
  transactions *without* an `input.type` user-event annotation. The editor's
  typing-triggered behaviour (indent-on-input, bracket auto-close, completion
  popups) never fires, so the cell always ends with exactly the target text.
- **Plan at load time, verified.** `src/planner.ts` builds human-like line
  steps from `(start, target)`: an LCS line diff, in-place edits for paired lines
  (select the differing middle and retype it), whole-line typing that begins with
  Enter (the newline and its indentation appear together, like auto-indent), and
  blank lines folded into the next step. The plan is replayed in memory and
  checked against the target; if they differ, it falls back to "select all and
  retype".
- **One player, two modes** (`src/player.ts`), toggled globally:
  - **step**: `Alt+N` types the next line at a jittered speed. Pressing it again
    mid-line finishes the line at once.
  - **hacker**: `Alt+N` arms the cell. Each plain key press then types the next
    1–3 script characters. The keys pressed never reach the cell, even after the
    script ends. `Shift+Enter` (run), `Esc` or `Alt+N` disarms it.
- `Alt+Shift+N` finishes the cell, `Alt+Shift+U` undoes a step,
  `Alt+Shift+R` resets the cell, `Alt+Shift+M` toggles the mode. Speeds and other
  options are in Settings → CLM Typing Replay.

## Spike results (2026-10-02, JupyterLab 4.5.7 + RISE fork 0.43.1)

Verified in the browser on a notebook with C++ (`xcpp17`) metadata, in the
CodeMirror `cpp` language mode:

- An empty cell was typed to the exact target in step mode. Lines with `{`,
  nested indentation and closing `}` were not re-indented, and no braces were
  auto-closed.
- start→completed: `/* TODO */` was selected, shown, deleted and retyped as
  `6 * 7`. A class grew two methods and an attribute in place.
- Hacker mode with real browser key events: the result was exact, nothing typed
  leaked into the cell, and over-typing past the end was harmless.
- In the RISE slideshow (iframe app), the extension loaded and step mode with
  flush and finish worked.

Not yet tested: a live `xcpp17` kernel in the Docker image (Docker Desktop was
down). Typing doesn't depend on the kernel, but the extension still has to be
installed into the image.

## Develop

```bash
npm install
npm test                                   # planner + player unit tests (node --test)
npm run build                              # tsc + jupyter labextension build (needs jupyter on PATH)
python scripts/dev_install.py <env-python> # copy the prebuilt extension into an env
python scripts/make_examples.py            # regenerate examples/*.ipynb
```
