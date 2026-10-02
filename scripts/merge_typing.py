"""Stand-in for clm #1023: build a typing notebook from clm's code-along and
completed outputs of the same deck.

clm keeps cell ids stable across output kinds, so cells pair by id:

- a code cell present in both, with different source -> typing target;
- a code-along cell missing from the completed notebook is a ``start`` cell;
  its target is the first completed-only code cell after the previous shared
  cell (the ``completed`` half of the pair).

Usage: python scripts/merge_typing.py CODE_ALONG.ipynb COMPLETED.ipynb -o OUT.ipynb
       python scripts/merge_typing.py --scan DIR   # list decks by typing-cell count
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def src(cell: dict) -> str:
    s = cell.get("source", "")
    return "".join(s) if isinstance(s, list) else s


def merge(code_along: dict, completed: dict) -> tuple[dict, int, int]:
    comp_cells = completed["cells"]
    comp_index = {c.get("id"): i for i, c in enumerate(comp_cells)}
    ca_ids = {c.get("id") for c in code_along["cells"]}
    last_shared = -1
    n_plain = n_start = 0
    for cell in code_along["cells"]:
        cid = cell.get("id")
        if cid in comp_index:
            last_shared = comp_index[cid]
            if cell["cell_type"] != "code":
                continue
            target = src(comp_cells[comp_index[cid]])
            n_plain += _attach(cell, target)
        elif cell["cell_type"] == "code":
            for j in range(last_shared + 1, len(comp_cells)):
                cand = comp_cells[j]
                if cand["cell_type"] == "code" and cand.get("id") not in ca_ids:
                    n_start += _attach(cell, src(cand))
                    last_shared = j
                    break
    return code_along, n_plain, n_start


def _attach(cell: dict, target: str) -> int:
    start = src(cell)
    if target == start:
        return 0
    cell.setdefault("metadata", {}).setdefault("clm", {})["typing"] = {
        "start": start,
        "target": target,
    }
    return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("code_along", nargs="?")
    ap.add_argument("completed", nargs="?")
    ap.add_argument("-o", "--out")
    ap.add_argument("--scan", help="Code-Along dir; Completed is its sibling")
    a = ap.parse_args()
    if a.scan:
        root = Path(a.scan)
        rows = []
        for ca in root.rglob("*.ipynb"):
            comp = root.parent / "Completed" / ca.relative_to(root)
            if comp.exists():
                load = lambda p: json.loads(p.read_text(encoding="utf-8"))  # noqa: E731
                _, p, s = merge(load(ca), load(comp))
                rows.append((s, p, ca.relative_to(root)))
        for s, p, rel in sorted(rows, reverse=True)[:15]:
            print(f"start={s:2d} plain={p:3d}  {rel}")
        return 0
    nb_a = json.loads(Path(a.code_along).read_text(encoding="utf-8"))
    nb_c = json.loads(Path(a.completed).read_text(encoding="utf-8"))
    nb, p, s = merge(nb_a, nb_c)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {a.out}: {p} empty->completed cells, {s} start->completed cells")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
