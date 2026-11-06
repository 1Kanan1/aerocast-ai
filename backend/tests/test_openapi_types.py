from app.tools.openapi_types import _declaration, _type


def test_refs_arrays_unions_and_records() -> None:
    assert _type({"$ref": "#/components/schemas/Station"}, 0) == "Station"
    assert (
        _type(
            {"type": "array", "items": {"$ref": "#/components/schemas/A"}}, 0
        )
        == "A[]"
    )
    assert (
        _type({"anyOf": [{"type": "string"}, {"type": "null"}]}, 0)
        == "string | null"
    )
    assert (
        _type({"type": "object", "additionalProperties": True}, 0)
        == "Record<string, unknown>"
    )
    assert (
        _type({"type": "string", "enum": ["ok", "degraded"]}, 0)
        == '"ok" | "degraded"'
    )


def test_optional_fields_are_marked() -> None:
    declaration = _declaration(
        "X",
        {
            "type": "object",
            "properties": {"a": {"type": "string"}, "b": {"type": "string"}},
            "required": ["a"],
        },
    )

    assert declaration == (
        "export interface X {\n  a: string\n  b?: string\n}\n"
    )
