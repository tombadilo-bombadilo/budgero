"""Single source of truth for the SDK version.

Read by ``budgero.__init__`` (as ``budgero.__version__``), by the HTTP
client's User-Agent header, and by the build backend (hatchling) via
``[tool.hatch.version]`` in pyproject.toml.
"""

__version__ = "1.0.0"
