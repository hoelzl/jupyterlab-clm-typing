# jupyterlab-clm-typing

## Install

```bash
pip install git+https://github.com/hoelzl/jupyterlab-clm-typing
```

The frontend is prebuilt and committed (`jupyterlab_clm_typing/labextension/`),
so installing needs no Node. Works in JupyterLab 4 and Notebook 7, including the
RISE slideshow. In a Dockerfile, add that line after JupyterLab is installed.

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

### Live C++ kernel (2026-10-02, `cam-notebook:0.5.2-cpp`, Notebook 7.6 / JupyterLab 4.6.1, xcpp20)

The wheel was pip-installed into the running container, and the extension
loaded on page reload, with no server restart. Two real decks from CppCourses
(`C++ Einsteiger-de`, "07 Member Functions" and "09 Structs und Klassen") were
turned into typing notebooks with `scripts/merge_typing.py` (a stand-in for clm
#1023).

- Every cell was typed and then run in order in the live kernel, with no
  compile errors. This included the struct→class rewrite of `MyComplex` in 22
  animated steps (step mode) and the `c.re = 3` → `c.set_re(3)` in-place edits.
- In hacker mode, about 100 real key presses typed exactly `p1.distance(p2)`.
  The real Shift+Enter disarmed the cell and ran it.
- The deck's first cell is a `start`/`completed` pair (`struct Point` gains
  `distance`). Running it without typing it leaves later cells failing to
  compile, so a recording has to type it. That's the deck's logic, not a replay
  defect.
- `merge_typing.py` pairs cells by output cell id. clm's output ids appear to be
  positional (that start/completed pair shares one id across code-along and
  completed), so the stand-in can mis-pair decks where pairs shift positions.
  clm #1023 pairs by source tags instead.

## Develop

A plan preview for a notebook's typing cells: `node scripts/show_plan.ts NB.ipynb`.
To build a typing notebook from clm outputs before clm #1023 lands:
`python scripts/merge_typing.py CODE_ALONG.ipynb COMPLETED.ipynb -o OUT.ipynb`
(`--scan <Code-Along dir>` ranks decks by typing cells).

After changing `src/`, run `npm run build` and **commit
`jupyterlab_clm_typing/labextension/`**; it's what pip installs.

```bash
npm install
npm test                                   # planner + player unit tests (node --test)
npm run build                              # tsc + jupyter labextension build (needs jupyter on PATH)
python scripts/dev_install.py <env-python> # copy the prebuilt extension into an env (dev)
uv build --wheel                           # wheel in dist/
python scripts/make_examples.py            # regenerate examples/*.ipynb
```
