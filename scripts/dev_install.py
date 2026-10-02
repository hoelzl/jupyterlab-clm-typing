"""Install the built labextension into a JupyterLab environment (dev spike).

Copies ``jupyterlab_clm_typing/labextension`` to
``<prefix>/share/jupyter/labextensions/jupyterlab-clm-typing`` where JupyterLab
discovers prebuilt extensions. Run ``npm run build`` first.

Usage: python scripts/dev_install.py <path-to-env-python>
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILT = ROOT / "jupyterlab_clm_typing" / "labextension"


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    python = sys.argv[1]
    prefix = subprocess.run(
        [python, "-c", "import sys; print(sys.prefix)"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    dest = Path(prefix) / "share" / "jupyter" / "labextensions" / "jupyterlab-clm-typing"
    if not (BUILT / "package.json").exists():
        print(f"No build output at {BUILT}; run `npm run build` first.")
        return 1
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(BUILT, dest)
    print(f"Installed to {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
