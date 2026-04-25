"""
sulcus-core-tools — Single source of truth for Sulcus tool definitions.

Usage:
    from sulcus_core_tools import handler, tool_defs
    from sulcus_core_tools.formatters import openai, anthropic, gemini
    from sulcus_core_tools.dispatchers import openai as openai_dispatch
"""

from .tool_defs import TOOLS, get_tools, get_core_tools, get_extended_tools
from .handler import dispatch, DISPATCH

__all__ = [
    "TOOLS",
    "get_tools",
    "get_core_tools",
    "get_extended_tools",
    "dispatch",
    "DISPATCH",
]
