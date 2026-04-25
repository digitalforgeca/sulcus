"""Anthropic tool_use dispatcher for Sulcus tools."""

from __future__ import annotations

import json
from typing import Any

from ..handler import dispatch


def handle_tool_use(tool_use_block: Any) -> dict:
    """Dispatch an Anthropic ToolUseBlock to the appropriate Sulcus handler.

    Accepts either an anthropic.types.ToolUseBlock object or a plain dict
    with {"id", "type": "tool_use", "name", "input"}.

    Returns a ToolResultBlockParam dict ready to include in the next user message.
    """
    if hasattr(tool_use_block, "id"):
        tool_id = tool_use_block.id
        name = tool_use_block.name
        args = tool_use_block.input
    elif isinstance(tool_use_block, dict):
        tool_id = tool_use_block["id"]
        name = tool_use_block["name"]
        args = tool_use_block.get("input", {})
    else:
        return {
            "type": "tool_result",
            "tool_use_id": "unknown",
            "content": json.dumps({"error": f"Unrecognised format: {type(tool_use_block)}"}),
            "is_error": True,
        }

    try:
        if isinstance(args, str):
            args = json.loads(args)
        result = dispatch(name, args)
        return {
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": json.dumps(result),
            "is_error": False,
        }
    except KeyError:
        return {
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": json.dumps({"error": f"Unknown tool: {name}"}),
            "is_error": True,
        }
    except (TypeError, ValueError) as exc:
        return {
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": json.dumps({"error": f"Bad arguments for {name}: {exc}"}),
            "is_error": True,
        }
    except RuntimeError as exc:
        return {
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": json.dumps({"error": str(exc)}),
            "is_error": True,
        }
    except Exception as exc:
        return {
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": json.dumps({"error": f"Unexpected error in {name}: {exc}"}),
            "is_error": True,
        }
