"""Format Sulcus tool definitions for Anthropic tool_use."""

from __future__ import annotations

import json
from typing import Any

from ..tool_defs import ToolDef, Param, get_tools


def _param_to_schema(p: Param) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": p.type.value, "description": p.description}
    if p.enum:
        schema["enum"] = p.enum
    if p.minimum is not None:
        schema["minimum"] = p.minimum
    if p.maximum is not None:
        schema["maximum"] = p.maximum
    if p.format:
        schema["format"] = p.format
    return schema


def format_tool(tool: ToolDef) -> dict[str, Any]:
    """Convert a ToolDef to Anthropic tool_use format."""
    properties = {}
    required = []
    for p in tool.params:
        properties[p.name] = _param_to_schema(p)
        if p.required:
            required.append(p.name)

    result: dict[str, Any] = {
        "name": tool.name,
        "description": tool.description,
        "input_schema": {
            "type": "object",
            "properties": properties,
        },
    }
    if required:
        result["input_schema"]["required"] = required
    return result


def format_tools(categories: list[str] | None = None) -> list[dict[str, Any]]:
    """Format all tools for Anthropic."""
    return [format_tool(t) for t in get_tools(categories)]


def to_json(categories: list[str] | None = None, indent: int = 2) -> str:
    """Generate tools.json content for Anthropic."""
    return json.dumps(format_tools(categories), indent=indent)
