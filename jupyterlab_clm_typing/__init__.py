"""JupyterLab extension: replay code-along -> completed cells as simulated typing."""

__version__ = "0.1.1"


def _jupyter_labextension_paths() -> list[dict[str, str]]:
    return [{"src": "labextension", "dest": "jupyterlab-clm-typing"}]
