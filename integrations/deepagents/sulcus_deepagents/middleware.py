"""SulcusMemoryMiddleware — Drop-in replacement for DeepAgents MemoryMiddleware.

DeepAgents' built-in MemoryMiddleware loads flat AGENTS.md files from disk
and injects them verbatim into the system prompt. Updates require the LLM
to call edit_file and manually rewrite the Markdown.

SulcusMemoryMiddleware replaces this with the Sulcus thermodynamic engine:

- **On every turn**: searches Sulcus for memories relevant to the current
  conversation and injects them as structured context in the system prompt.
- **Heat propagation**: recently accessed and frequently recalled memories
  surface first. Cold memories fade naturally.
- **Cross-session persistence**: memories survive across agent runs, sandbox
  restarts, and even different agent instances sharing the same tenant.
- **No file editing required**: the LLM doesn't need to manually manage
  a Markdown file. Memory storage and retrieval are automatic.

Usage::

    from sulcus import Sulcus
    from sulcus_deepagents import SulcusMemoryMiddleware
    from deepagents import create_deep_agent

    client = Sulcus(api_key="sk-...")
    agent = create_deep_agent(
        middleware=[SulcusMemoryMiddleware(client=client)]
    )
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, NotRequired, Annotated

from langchain.agents.middleware.types import (
    AgentMiddleware,
    AgentState,
    ContextT,
    ModelRequest,
    ModelResponse,
    PrivateStateAttr,
    ResponseT,
)
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable
    from langchain_core.runnables import RunnableConfig
    from langgraph.runtime import Runtime

from sulcus import Sulcus

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# State schema
# ---------------------------------------------------------------------------

class SulcusMemoryState(AgentState):
    """Extended state carrying Sulcus context injection metadata."""

    sulcus_context: NotRequired[Annotated[str | None, PrivateStateAttr]]


# ---------------------------------------------------------------------------
# System prompt template
# ---------------------------------------------------------------------------

SULCUS_MEMORY_PROMPT = """<sulcus_memory>
{memory_context}
</sulcus_memory>

<sulcus_guidelines>
The above <sulcus_memory> block contains relevant memories retrieved from
your persistent reactive, thermodynamic memory graph. These are ranked by relevance
and heat (recency × frequency × importance).

Key behaviors:
- Reference these memories naturally in your responses
- Memories marked [PINNED] are permanently important — never ignore them
- High-heat memories are currently active context; low-heat are fading
- You don't need to manually manage a memory file — use the sulcus_store
  tool when you learn something new, and Sulcus handles the rest
- Preferences, facts, and procedures persist across sessions automatically
</sulcus_guidelines>
"""


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------

class SulcusMemoryMiddleware(AgentMiddleware[SulcusMemoryState, ContextT, ResponseT]):
    """Injects Sulcus memories into the DeepAgent system prompt.

    On each model call, extracts the latest user message, searches Sulcus
    for relevant memories, and prepends them to the system prompt.

    Args:
        client: An initialised :class:`sulcus.Sulcus` instance.
        search_limit: Maximum memories to inject per turn (default 15).
        token_budget: Approximate token budget for memory context (default 2000).
        memory_types: Optional list of memory types to include.
            Defaults to all types.
        min_heat: Minimum heat threshold for included memories (default 0.0).
    """

    state_schema = SulcusMemoryState

    def __init__(
        self,
        client: Sulcus,
        *,
        search_limit: int = 15,
        token_budget: int = 2000,
        memory_types: list[str] | None = None,
        min_heat: float = 0.0,
    ) -> None:
        self.client = client
        self.search_limit = search_limit
        self.token_budget = token_budget
        self.memory_types = memory_types
        self.min_heat = min_heat

    def _extract_query(self, messages: list[Any]) -> str:
        """Extract a search query from the most recent messages."""
        # Take last 3 messages for context
        recent = messages[-3:] if len(messages) > 3 else messages
        parts = []
        for msg in recent:
            if isinstance(msg, (HumanMessage, AIMessage)):
                content = msg.content if isinstance(msg.content, str) else str(msg.content)
                parts.append(content[:500])  # Truncate long messages
        return " ".join(parts) if parts else ""

    def _build_context(self, memories: list[dict[str, Any]]) -> str:
        """Build a structured context string from search results."""
        if not memories:
            return "No relevant memories found."

        # Group by type
        groups: dict[str, list[str]] = {}
        char_budget = self.token_budget * 4  # ~4 chars/token
        total_chars = 0

        for mem in memories:
            heat = mem.get("current_heat", 0.0)
            if heat < self.min_heat:
                continue

            mtype = mem.get("memory_type", "episodic")
            if self.memory_types and mtype not in self.memory_types:
                continue

            summary = mem.get("pointer_summary", mem.get("label", ""))
            if not summary:
                continue

            pinned = mem.get("pinned", False)
            heat_str = f"{heat:.2f}"
            prefix = "[PINNED] " if pinned else ""
            line = f"{prefix}(heat: {heat_str}) {summary}"

            if total_chars + len(line) > char_budget:
                break

            groups.setdefault(mtype, []).append(line)
            total_chars += len(line)

        # Render grouped output
        lines = []
        type_order = ["preference", "procedural", "semantic", "episodic"]
        for t in type_order:
            items = groups.get(t, [])
            if items:
                lines.append(f"\n[{t.upper()}]")
                for item in items:
                    lines.append(f"  • {item}")

        # Include any other types not in the standard order
        for t, items in groups.items():
            if t not in type_order and items:
                lines.append(f"\n[{t.upper()}]")
                for item in items:
                    lines.append(f"  • {item}")

        return "\n".join(lines) if lines else "No relevant memories found."

    async def call_model(
        self,
        state: SulcusMemoryState,
        call_next: Callable[
            [SulcusMemoryState, ModelRequest], Awaitable[ModelResponse]
        ],
        request: ModelRequest,
        runtime: Runtime,
        config: RunnableConfig,
    ) -> ModelResponse:
        """Intercept model calls to inject Sulcus memory context."""
        messages = list(state.get("messages", []))

        # Extract query from recent messages
        query = self._extract_query(messages)

        if query:
            try:
                results = self.client.search(query, limit=self.search_limit)
                context = self._build_context(results)
            except Exception as e:
                logger.warning(f"Sulcus search failed: {e}")
                context = "Memory search unavailable."
        else:
            context = "No conversation context yet."

        # Inject into system prompt
        memory_block = SULCUS_MEMORY_PROMPT.format(memory_context=context)

        # Find and extend the system message, or create one
        new_messages = []
        injected = False
        for msg in messages:
            if isinstance(msg, SystemMessage) and not injected:
                content = msg.content if isinstance(msg.content, str) else str(msg.content)
                new_msg = SystemMessage(content=content + "\n\n" + memory_block)
                new_messages.append(new_msg)
                injected = True
            else:
                new_messages.append(msg)

        if not injected:
            new_messages.insert(0, SystemMessage(content=memory_block))

        # Update state with injected messages
        new_state = {**state, "messages": new_messages, "sulcus_context": context}

        return await call_next(new_state, request)
