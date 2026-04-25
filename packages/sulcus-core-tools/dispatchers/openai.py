"""OpenAI function calling dispatcher for Sulcus tools."""

from __future__ import annotations

import json
from typing import Any

from ..handler import dispatch, DISPATCH


def handle_tool_call(tool_call: Any) -> str:
    """Dispatch an OpenAI tool_call to the appropriate Sulcus handler.

    Accepts either an openai.types.chat.ChatCompletionMessageToolCall object
    or a plain dict with {"id", "type", "function": {"name", "arguments"}}.

    Returns a JSON string ready to use as tool message content.
    """
    if hasattr(tool_call, "function"):
        name = tool_call.function.name
        raw_args = tool_call.function.arguments
    elif isinstance(tool_call, dict):
        name = tool_call["function"]["name"]
        raw_args = tool_call["function"]["arguments"]
    else:
        return json.dumps({"error": f"Unrecognised tool_call format: {type(tool_call)}"})

    try:
        args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
        result = dispatch(name, args)
        return json.dumps(result)
    except KeyError:
        return json.dumps({"error": f"Unknown tool: {name}"})
    except (TypeError, ValueError) as exc:
        return json.dumps({"error": f"Bad arguments for {name}: {exc}"})
    except RuntimeError as exc:
        return json.dumps({"error": str(exc)})
    except Exception as exc:
        return json.dumps({"error": f"Unexpected error in {name}: {exc}"})
