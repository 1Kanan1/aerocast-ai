"""The app's import graph must stay acyclic.

A cycle is how a small module turns into a knot: the import works until it
does not, and the failure appears at startup or in a test that imports the
other end. Ruff's rule set does not look for cycles, so this walks the
imports itself, the same way test_domain_purity walks the domain layer.
"""

from __future__ import annotations

import ast
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1] / "app"
PACKAGE = "app"


def _module_name(path: Path) -> str:
    parts = path.relative_to(APP_ROOT.parent).with_suffix("").parts
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def _app_imports(path: Path, module: str) -> set[str]:
    """Absolute `app.*` imports, plus any submodule a from-import names."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: set[str] = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(
                alias.name
                for alias in node.names
                if alias.name == PACKAGE
                or alias.name.startswith(f"{PACKAGE}.")
            )
        elif isinstance(node, ast.ImportFrom):
            base = _absolute_module(path, module, node)
            if base is None:
                continue
            found.add(base)
            # `from app.llm import client` names a module as an attribute.
            for alias in node.names:
                found.add(f"{base}.{alias.name}")

    return found


def _absolute_module(
    path: Path, module: str, node: ast.ImportFrom
) -> str | None:
    if node.level == 0:
        base = node.module
        if base is None or not (
            base == PACKAGE or base.startswith(f"{PACKAGE}.")
        ):
            return None
        return base

    # `from .x import y` in `app/a/b.py` is `app.a.x`; in `app/a/__init__.py`
    # the module is already the package, so it is `app.a.x` as well.
    base = module if path.name == "__init__.py" else module.rpartition(".")[0]
    for _ in range(node.level - 1):
        base = base.rpartition(".")[0]
    return f"{base}.{node.module}" if node.module else base


def _graph() -> dict[str, set[str]]:
    known = {_module_name(path) for path in APP_ROOT.rglob("*.py")}
    graph: dict[str, set[str]] = {module: set() for module in known}

    for path in APP_ROOT.rglob("*.py"):
        module = _module_name(path)
        for imported in _app_imports(path, module):
            if imported in known:
                graph[module].add(imported)
    return graph


def _find_cycle(graph: dict[str, set[str]]) -> list[str] | None:
    """The first cycle in a depth-first walk, as the path that closes it."""
    visiting: list[str] = []
    done: set[str] = set()

    def walk(module: str) -> list[str] | None:
        if module in visiting:
            return [*visiting[visiting.index(module) :], module]
        if module in done:
            return None

        visiting.append(module)
        for imported in sorted(graph[module]):
            cycle = walk(imported)
            if cycle is not None:
                return cycle
        visiting.pop()
        done.add(module)
        return None

    for module in sorted(graph):
        cycle = walk(module)
        if cycle is not None:
            return cycle
    return None


def test_the_app_import_graph_has_no_cycles() -> None:
    cycle = _find_cycle(_graph())

    assert cycle is None, " -> ".join(cycle or [])


def test_the_walk_finds_a_cycle_in_a_synthetic_graph() -> None:
    assert _find_cycle({"a": {"b"}, "b": {"c"}, "c": {"a"}}) == [
        "a",
        "b",
        "c",
        "a",
    ]
    assert _find_cycle({"a": {"b"}, "b": set()}) is None


def test_a_relative_import_resolves_against_its_package() -> None:
    node = ast.parse("from .models import forecast").body[0]
    assert isinstance(node, ast.ImportFrom)

    assert _absolute_module(
        Path("app/brief/__init__.py"), "app.brief", node
    ) == ("app.brief.models")
    assert _absolute_module(
        Path("app/brief/builder.py"), "app.brief.builder", node
    ) == ("app.brief.models")
