"""CrewAI tool wrappers for Sulcus memory operations.

Three tools:
- SulcusSearchTool  — search memories by natural language query
- SulcusStoreTool   — store a new memory with type + optional metadata
- SulcusContextTool — build a context window from relevant memories

Each is a subclass of crewai.tools.BaseTool so it integrates natively
with any CrewAI agent.
"""

from __future__ import annotations

from typing import Any, Optional, Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from sulcus import Sulcus


# ---------------------------------------------------------------------------
# Input schemas
# ---------------------------------------------------------------------------

class SearchInput(BaseModel):
    """Input for searching Sulcus memory."""
    query: str = Field(..., description="Natural language search query")
    limit: int = Field(default=5, description="Maximum number of results (1-50)")
    memory_type: Optional[str] = Field(
        default=None,
        description="Filter by memory type: episodic, semantic, preference, procedural",
    )


class StoreInput(BaseModel):
    """Input for storing a new memory in Sulcus."""
    content: str = Field(..., description="The content to remember")
    memory_type: str = Field(
        default="semantic",
        description="Memory type: episodic, semantic, preference, procedural",
    )
    label: Optional[str] = Field(
        default=None,
        description="Short label/title for the memory (auto-generated if omitted)",
    )


class ContextInput(BaseModel):
    """Input for building a context window from Sulcus memories."""
    prompt: str = Field(..., description="The current task or question to build context for")
    token_budget: int = Field(default=2000, description="Maximum tokens in the context window")


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

class SulcusSearchTool(BaseTool):
    """Search Sulcus memory for relevant information.

    Returns the most relevant memories ranked by semantic similarity and
    thermodynamic heat. Hotter memories (recently accessed, frequently
    recalled) rank higher.
    """

    name: str = "sulcus_search"
    description: str = (
        "Search your memory graph for relevant information. "
        "Returns memories ranked by relevance and recency. "
        "Use this before starting a task to recall prior context."
    )
    args_schema: Type[BaseModel] = SearchInput
    client: Any = Field(..., exclude=True)

    def __init__(self, client: Sulcus, **kwargs: Any) -> None:
        super().__init__(client=client, **kwargs)

    def _run(self, query: str, limit: int = 5, memory_type: Optional[str] = None) -> str:
        """Execute the search synchronously."""
        results = self.client.search(query, limit=limit)

        if memory_type:
            results = [r for r in results if r.get("memory_type") == memory_type]

        if not results:
            return "No relevant memories found."

        lines = []
        for i, r in enumerate(results, 1):
            mtype = r.get("memory_type", "unknown")
            heat = r.get("current_heat", 0.0)
            summary = r.get("pointer_summary", r.get("label", ""))
            lines.append(f"{i}. [{mtype}] (heat: {heat:.2f}) {summary}")

        return "\n".join(lines)


class SulcusStoreTool(BaseTool):
    """Store information in Sulcus memory.

    Creates a new memory node in the thermodynamic graph. The memory
    will be searchable immediately and will decay naturally based on
    its type unless pinned or frequently recalled.
    """

    name: str = "sulcus_store"
    description: str = (
        "Store important information in persistent memory. "
        "Use for facts, discoveries, user preferences, or procedures "
        "that should be available in future sessions."
    )
    args_schema: Type[BaseModel] = StoreInput
    client: Any = Field(..., exclude=True)

    def __init__(self, client: Sulcus, **kwargs: Any) -> None:
        super().__init__(client=client, **kwargs)

    def _run(
        self,
        content: str,
        memory_type: str = "semantic",
        label: Optional[str] = None,
    ) -> str:
        """Store a memory synchronously."""
        result = self.client.remember(content, memory_type=memory_type)

        node_id = result.get("node_id", result.get("id", "unknown"))
        return f"Stored as {memory_type} memory (id: {node_id})"


class SulcusContextTool(BaseTool):
    """Build a context window from relevant Sulcus memories.

    Assembles a structured context block from the most relevant
    memories for the current task. Respects a token budget and
    includes preferences, facts, procedures, and recent context.
    """

    name: str = "sulcus_context"
    description: str = (
        "Build a comprehensive context window from your memory graph. "
        "Use at the start of complex tasks to load all relevant background. "
        "More thorough than search — includes preferences, facts, and procedures."
    )
    args_schema: Type[BaseModel] = ContextInput
    client: Any = Field(..., exclude=True)

    def __init__(self, client: Sulcus, **kwargs: Any) -> None:
        super().__init__(client=client, **kwargs)

    def _run(self, prompt: str, token_budget: int = 2000) -> str:
        """Build context synchronously."""
        # Use the search endpoint to get relevant memories within budget
        results = self.client.search(prompt, limit=20)

        if not results:
            return "No relevant context found in memory."

        # Build structured context within approximate token budget
        sections: dict[str, list[str]] = {
            "preference": [],
            "procedural": [],
            "semantic": [],
            "episodic": [],
        }

        char_budget = token_budget * 4  # ~4 chars per token
        total_chars = 0

        for r in results:
            mtype = r.get("memory_type", "episodic")
            summary = r.get("pointer_summary", r.get("label", ""))
            if not summary:
                continue

            if total_chars + len(summary) > char_budget:
                break

            bucket = sections.get(mtype, sections["episodic"])
            bucket.append(summary)
            total_chars += len(summary)

        # Render
        lines = ["=== Memory Context ==="]
        for section_name, items in sections.items():
            if items:
                lines.append(f"\n[{section_name.upper()}]")
                for item in items:
                    lines.append(f"- {item}")

        return "\n".join(lines)
