"""Sulcus memory tools for Deep Agents.

Provides tool middleware that adds Sulcus memory operations to any Deep Agent.
Instead of using edit_file to rewrite AGENTS.md, the agent gets purpose-built
memory tools: store, search, recall, pin, and forget.

These tools integrate with the DeepAgents middleware system and are available
to both the main agent and any sub-agents.

Usage::

    from sulcus import Sulcus
    from sulcus_deepagents import SulcusMemoryTools
    from deepagents import create_deep_agent

    client = Sulcus(api_key="sk-...")
    agent = create_deep_agent(
        middleware=[SulcusMemoryTools(client=client)]
    )
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Optional

from langchain_core.tools import BaseTool, ToolException
from pydantic import BaseModel, Field

from sulcus import Sulcus

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tool input schemas
# ---------------------------------------------------------------------------

class StoreMemoryInput(BaseModel):
    """Input for storing a memory."""
    content: str = Field(..., description="The information to remember")
    memory_type: str = Field(
        default="semantic",
        description=(
            "Type of memory: 'episodic' (events/conversations), "
            "'semantic' (facts/knowledge), 'preference' (opinions/settings), "
            "'procedural' (workflows/how-tos), 'moment' (significant interactions)"
        ),
    )
    importance: str = Field(
        default="normal",
        description=(
            "How important: 'low' (will decay quickly), "
            "'normal' (standard decay), 'high' (slow decay, pinned)"
        ),
    )


class SearchMemoryInput(BaseModel):
    """Input for searching memory."""
    query: str = Field(..., description="Natural language search query")
    limit: int = Field(default=10, description="Maximum results (1-50)")
    memory_type: Optional[str] = Field(
        default=None,
        description="Filter by type: episodic, semantic, preference, procedural",
    )


class RecallMemoryInput(BaseModel):
    """Input for recalling a specific memory by ID (boosts its heat)."""
    memory_id: str = Field(..., description="UUID of the memory to recall")


class ForgetMemoryInput(BaseModel):
    """Input for forgetting a specific memory."""
    memory_id: str = Field(..., description="UUID of the memory to forget/delete")


class PinMemoryInput(BaseModel):
    """Input for pinning/unpinning a memory."""
    memory_id: str = Field(..., description="UUID of the memory to pin/unpin")
    pinned: bool = Field(default=True, description="True to pin, False to unpin")


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

class SulcusStoreTool(BaseTool):
    """Store information in thermodynamic memory.

    Unlike editing a flat file, stored memories are automatically embedded,
    indexed, and connected to related concepts in the knowledge graph.
    They persist across sessions and decay based on their type and access
    patterns.
    """

    name: str = "sulcus_store"
    description: str = (
        "Store important information in persistent memory. Use this when you "
        "learn something new from the user — preferences, facts, procedures, "
        "or significant moments. Memories persist across sessions and are "
        "automatically surfaced when relevant. ALWAYS store new learnings "
        "immediately, before doing anything else."
    )
    args_schema: type[BaseModel] = StoreMemoryInput
    client: Any = Field(..., exclude=True)

    def __init__(self, client: Sulcus, **kwargs: Any) -> None:
        super().__init__(client=client, **kwargs)

    def _run(
        self,
        content: str,
        memory_type: str = "semantic",
        importance: str = "normal",
    ) -> str:
        try:
            result = self.client.remember(content, memory_type=memory_type)
            node_id = result.get("node_id", result.get("id", "unknown"))

            # Pin high-importance memories
            if importance == "high":
                try:
                    self.client.pin(node_id)
                except Exception:
                    pass  # Pin is best-effort

            return (
                f"✓ Stored as {memory_type} memory (id: {node_id}, "
                f"importance: {importance}). This will persist across sessions."
            )
        except Exception as e:
            raise ToolException(f"Failed to store memory: {e}") from e


class SulcusSearchTool(BaseTool):
    """Search thermodynamic memory for relevant information.

    Results are ranked by a combination of semantic similarity and
    thermodynamic heat. Hot memories (recently accessed, frequently
    recalled, topologically connected) rank higher than cold ones.
    """

    name: str = "sulcus_search"
    description: str = (
        "Search your persistent memory for relevant information. Returns "
        "memories ranked by relevance AND recency (thermodynamic heat). "
        "Use before starting tasks to recall prior context, user preferences, "
        "established patterns, and learned procedures."
    )
    args_schema: type[BaseModel] = SearchMemoryInput
    client: Any = Field(..., exclude=True)

    def __init__(self, client: Sulcus, **kwargs: Any) -> None:
        super().__init__(client=client, **kwargs)

    def _run(
        self,
        query: str,
        limit: int = 10,
        memory_type: Optional[str] = None,
    ) -> str:
        try:
            results = self.client.search(query, limit=limit)

            if memory_type:
                results = [r for r in results if r.get("memory_type") == memory_type]

            if not results:
                return "No relevant memories found."

            lines = []
            for i, r in enumerate(results, 1):
                mtype = r.get("memory_type", "unknown")
                heat = r.get("current_heat", 0.0)
                pinned = r.get("pinned", False)
                node_id = r.get("id", "?")
                summary = r.get("pointer_summary", r.get("label", ""))
                pin_marker = " [PINNED]" if pinned else ""
                lines.append(
                    f"{i}. [{mtype}] (heat: {heat:.2f}{pin_marker}) {summary}\n"
                    f"   id: {node_id}"
                )

            return "\n".join(lines)
        except Exception as e:
            raise ToolException(f"Memory search failed: {e}") from e


class SulcusRecallTool(BaseTool):
    """Recall a specific memory, boosting its heat.

    When you actively use a memory, recalling it signals to the
    thermodynamic engine that it's still relevant. This prevents
    important memories from decaying.
    """

    name: str = "sulcus_recall"
    description: str = (
        "Recall a specific memory by ID to boost its heat. Use when you "
        "actively reference a memory — this tells the engine it's still "
        "important and prevents it from decaying."
    )
    args_schema: type[BaseModel] = RecallMemoryInput
    client: Any = Field(..., exclude=True)

    def __init__(self, client: Sulcus, **kwargs: Any) -> None:
        super().__init__(client=client, **kwargs)

    def _run(self, memory_id: str) -> str:
        try:
            # Search by ID to get details, which also triggers a heat boost
            results = self.client.search(memory_id, limit=1)
            if results:
                summary = results[0].get("pointer_summary", "")
                heat = results[0].get("current_heat", 0.0)
                return f"✓ Recalled memory: {summary} (heat now: {heat:.2f})"
            return f"Memory {memory_id} not found."
        except Exception as e:
            raise ToolException(f"Failed to recall memory: {e}") from e


class SulcusPinTool(BaseTool):
    """Pin or unpin a memory to prevent/allow decay.

    Pinned memories never decay — they stay at maximum heat permanently.
    Use for critical preferences, identity information, and core procedures.
    """

    name: str = "sulcus_pin"
    description: str = (
        "Pin a memory to prevent it from ever decaying, or unpin to "
        "allow natural decay. Pin critical user preferences, identity "
        "information, and core procedures."
    )
    args_schema: type[BaseModel] = PinMemoryInput
    client: Any = Field(..., exclude=True)

    def __init__(self, client: Sulcus, **kwargs: Any) -> None:
        super().__init__(client=client, **kwargs)

    def _run(self, memory_id: str, pinned: bool = True) -> str:
        try:
            if pinned:
                self.client.pin(memory_id)
                return f"✓ Memory {memory_id} pinned — it will never decay."
            else:
                self.client.unpin(memory_id)
                return f"✓ Memory {memory_id} unpinned — normal decay resumes."
        except Exception as e:
            raise ToolException(f"Failed to {'pin' if pinned else 'unpin'} memory: {e}") from e


class SulcusForgetTool(BaseTool):
    """Permanently delete a memory from the graph.

    Use when information is outdated, incorrect, or the user explicitly
    asks to forget something. This is irreversible.
    """

    name: str = "sulcus_forget"
    description: str = (
        "Permanently delete a memory. Use when information is outdated, "
        "incorrect, or the user asks to forget something. Irreversible."
    )
    args_schema: type[BaseModel] = ForgetMemoryInput
    client: Any = Field(..., exclude=True)

    def __init__(self, client: Sulcus, **kwargs: Any) -> None:
        super().__init__(client=client, **kwargs)

    def _run(self, memory_id: str) -> str:
        try:
            self.client.forget(memory_id)
            return f"✓ Memory {memory_id} permanently deleted."
        except Exception as e:
            raise ToolException(f"Failed to forget memory: {e}") from e


# ---------------------------------------------------------------------------
# Tool collection factory
# ---------------------------------------------------------------------------

def create_sulcus_tools(client: Sulcus) -> list[BaseTool]:
    """Create all Sulcus memory tools for a Deep Agent.

    Args:
        client: An initialised :class:`sulcus.Sulcus` instance.

    Returns:
        List of BaseTool instances ready to pass to create_deep_agent(tools=...).
    """
    return [
        SulcusStoreTool(client=client),
        SulcusSearchTool(client=client),
        SulcusRecallTool(client=client),
        SulcusPinTool(client=client),
        SulcusForgetTool(client=client),
    ]


# ---------------------------------------------------------------------------
# Middleware wrapper (adds tools automatically)
# ---------------------------------------------------------------------------

class SulcusMemoryTools:
    """Convenience wrapper that adds all Sulcus tools to a Deep Agent.

    Not a true middleware — instead, call `.tools()`` to get the tool list
    and pass to ``create_deep_agent(tools=[...])`` or combine with other tools.

    For middleware-style injection, use SulcusMemoryMiddleware instead.

    Usage::

        from sulcus import Sulcus
        from sulcus_deepagents import SulcusMemoryTools

        client = Sulcus(api_key="sk-...")
        memory_tools = SulcusMemoryTools(client=client)

        agent = create_deep_agent(tools=memory_tools.tools())
    """

    def __init__(self, client: Sulcus) -> None:
        self.client = client

    def tools(self) -> list[BaseTool]:
        """Return all Sulcus memory tools."""
        return create_sulcus_tools(self.client)
