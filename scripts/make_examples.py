"""Generate spike test notebooks with ``metadata.clm.typing`` plans.

This stands in for what CLM would emit in the *recording* output kind: code
cells carry their code-along source, and ``metadata.clm.typing.target`` holds
the completed source (``start`` is recorded so the cell can be reset).
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "examples"

CPP_META = {
    "kernelspec": {"display_name": "C++17", "language": "C++17", "name": "xcpp17"},
    "language_info": {
        "codemirror_mode": "text/x-c++src",
        "file_extension": ".cpp",
        "mimetype": "text/x-c++src",
        "name": "C++17",
        "version": "17",
    },
}

PY_META = {
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {"name": "python", "codemirror_mode": {"name": "ipython", "version": 3}},
}


def md(text: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": text}


def code(start: str, target: str | None = None) -> dict:
    meta: dict = {}
    if target is not None:
        meta["clm"] = {"typing": {"start": start, "target": target}}
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": meta,
        "outputs": [],
        "source": start,
    }


CPP_CELLS = [
    md("# Typing replay spike (C++)\n\nSelect a code cell, press **Alt+N**."),
    md("## Empty code-along cell"),
    code(
        "",
        "#include <vector>\n\n"
        "int sum(const std::vector<int>& xs) {\n"
        "    int total{0};\n"
        "    for (int x : xs) {\n"
        "        total += x;\n"
        "    }\n"
        "    return total;\n"
        "}",
    ),
    md("## Start/completed: placeholder in a line"),
    code(
        "int answer = /* TODO */;",
        "int answer = 6 * 7;",
    ),
    md("## Start/completed: class grows"),
    code(
        "class Point {\n"
        "public:\n"
        "    Point(double x, double y) : x_{x}, y_{y} {}\n"
        "\n"
        "private:\n"
        "    double x_;\n"
        "};",
        "class Point {\n"
        "public:\n"
        "    Point(double x, double y) : x_{x}, y_{y} {}\n"
        "\n"
        "    double x() const { return x_; }\n"
        "    double y() const { return y_; }\n"
        "\n"
        "private:\n"
        "    double x_;\n"
        "    double y_;\n"
        "};",
    ),
    md("## Cell without a plan (should warn)"),
    code("int unrelated = 1;"),
]

PY_CELLS = [
    md("# Typing replay spike (Python)"),
    code(
        "",
        "def fizzbuzz(n):\n"
        "    for i in range(1, n + 1):\n"
        "        if i % 15 == 0:\n"
        '            print("FizzBuzz")\n'
        "        elif i % 3 == 0:\n"
        '            print("Fizz")\n'
        "        else:\n"
        "            print(i)",
    ),
    code(
        "def area(r):\n    pass",
        "import math\n\n\ndef area(r):\n    return math.pi * r ** 2",
    ),
]


def write(name: str, cells: list[dict], meta: dict) -> None:
    nb = {"cells": cells, "metadata": meta, "nbformat": 4, "nbformat_minor": 5}
    for i, c in enumerate(nb["cells"]):
        c["id"] = f"cell-{i}"
    path = OUT / name
    path.write_text(json.dumps(nb, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {path}")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    write("typing_cpp.ipynb", CPP_CELLS, CPP_META)
    write("typing_py.ipynb", PY_CELLS, PY_META)
