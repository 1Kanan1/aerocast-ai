"""The domain layer has to stay readable and testable without any infrastructure.

The plan claims `app/domain/` imports nothing from the web framework, the database, the
network, or the model providers. That claim is worth a test, because it erodes quietly the
first time someone wants "just one query" inside a parser.
"""

from __future__ import annotations

import ast
from pathlib import Path

DOMAIN_ROOT = Path(__file__).resolve().parents[1] / "app" / "domain"

FORBIDDEN_ROOTS = frozenset(
    {
        "fastapi",
        "starlette",
        "sqlalchemy",
        "asyncpg",
        "httpx",
        "requests",
        "socket",
        "urllib",
        "openai",
        "pydantic",
        "anthropic",
    }
)

FORBIDDEN_PREFIXES = ("app.api", "app.db", "app.llm", "app.sources", "app.ingest", "app.tools")


def _imported_modules(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            modules.append(node.module)
    return modules


def test_domain_imports_nothing_from_outside_itself() -> None:
    offenders: list[str] = []

    for path in sorted(DOMAIN_ROOT.rglob("*.py")):
        for module in _imported_modules(path):
            if module.split(".")[0] in FORBIDDEN_ROOTS or module.startswith(FORBIDDEN_PREFIXES):
                offenders.append(f"{path.relative_to(DOMAIN_ROOT)} imports {module}")

    assert offenders == [], "\n".join(offenders)
