"""Format Sulcus tool definitions for Google Gemini function declarations."""

from __future__ import annotations

import json
from typing import Any

from ..tool_defs import ToolDef, Param, ParamType, get_tools

# Gemini uses uppercase type names
_TYPE_MAP = {
    ParamType.STRING: "STRING",
    ParamType.INTEGER: "INTEGER",
    ParamType.NUMBER: "NUMBER",
    ParamType.BOOLEAN: "BOOLEAN",
    ParamType.OBJECT: "OBJECT",
    ParamType.ARRAY: "ARRAY",
}


def _param_to_schema(p: Param) -> dict[str, Any]:
    schema: dict[str, Any] = {
        "type": _TYPE_MAP.get(p.type, "STRING"),
        "description": p.description,
    }
    if p.enum:
        schema["enum"] = p.enum
    return schema


def format_tool(tool: ToolDef) -> dict[str, Any]:
    """Convert a ToolDef to Gemini FunctionDeclaration format."""
    properties = {}
    required = []
    for p in tool.params:
        properties[p.name] = _param_to_schema(p)
        if p.required:
            required.append(p.name)

    result: dict[str, Any] = {
        "name": tool.name,
        "description": tool.description,
        "parameters": {
            "type": "OBJECT",
            "properties": properties,
        },
    }
    if required:
        result["parameters"]["required"] = required
    return result


def format_tools(categories: list[str] | None = None) -> list[dict[str, Any]]:
    """Format all tools for Gemini."""
    return [format_tool(t) for t in get_tools(categories)]


def format_tool_config(categories: list[str] | None = None) -> dict[str, Any]:
    """Generate a complete Gemini tools config block."""
    return {
        "tools": [{
            "function_declarations": format_tools(categories),
        }],
    }


def to_json(categories: list[str] | None = None, indent: int = 2) -> str:
    """Generate tools.json content for Gemini."""
    return json.dumps(format_tool_config(categories), indent=indent)
