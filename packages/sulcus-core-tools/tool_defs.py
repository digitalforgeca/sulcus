"""
Canonical Sulcus tool definitions.

Single source of truth — every integration formats from these definitions.
Add a tool here and all platforms get it automatically.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Schema primitives
# ---------------------------------------------------------------------------

class ParamType(str, Enum):
    STRING = "string"
    INTEGER = "integer"
    NUMBER = "number"
    BOOLEAN = "boolean"
    OBJECT = "object"
    ARRAY = "array"


@dataclass
class Param:
    """A single tool parameter."""
    name: str
    type: ParamType
    description: str
    required: bool = False
    default: Any = None
    enum: list[str] | None = None
    minimum: float | None = None
    maximum: float | None = None
    format: str | None = None  # e.g. "uuid"


@dataclass
class ToolDef:
    """A canonical Sulcus tool definition."""
    name: str
    description: str
    params: list[Param] = field(default_factory=list)
    category: str = "memory"  # memory, heat, context, trigger, graph, config, sync


# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------

TOOLS: list[ToolDef] = [
    # === Core memory tools ===
    ToolDef(
        name="sulcus_remember",
        description=(
            "Store a memory in Sulcus. Call this whenever the user shares something "
            "that should be remembered across conversations: facts, preferences, decisions, "
            "procedures, or events. Choose memory_type to categorize it correctly."
        ),
        category="memory",
        params=[
            Param("content", ParamType.STRING, "The text content to store as a memory.", required=True),
            Param("memory_type", ParamType.STRING,
                  "Category: 'semantic' = facts/knowledge, 'episodic' = events/history, "
                  "'preference' = user preferences, 'procedural' = step-by-step instructions.",
                  enum=["episodic", "semantic", "preference", "procedural"],
                  default="semantic"),
            Param("heat", ParamType.NUMBER,
                  "Initial activation heat (0.0–100.0). Higher heat makes this memory surface more often.",
                  minimum=0.0, maximum=100.0, default=80.0),
            Param("namespace", ParamType.STRING,
                  "Optional namespace to scope this memory to (e.g. 'project-alpha')."),
        ],
    ),

    ToolDef(
        name="sulcus_search",
        description=(
            "Search memories using hybrid semantic + full-text search. Call this before "
            "answering questions that may involve past context, preferences, or known facts."
        ),
        category="memory",
        params=[
            Param("query", ParamType.STRING, "Natural language search query.", required=True),
            Param("limit", ParamType.INTEGER, "Maximum number of results (1-50).",
                  minimum=1, maximum=50, default=10),
            Param("memory_type", ParamType.STRING,
                  "Filter by memory type.",
                  enum=["episodic", "semantic", "preference", "procedural"]),
        ],
    ),

    ToolDef(
        name="sulcus_list",
        description=(
            "List memories with optional filters. Use to browse memories by type, "
            "namespace, or pinned status."
        ),
        category="memory",
        params=[
            Param("page", ParamType.INTEGER, "Page number (1-indexed).", minimum=1, default=1),
            Param("page_size", ParamType.INTEGER, "Results per page.", minimum=1, maximum=100, default=20),
            Param("memory_type", ParamType.STRING, "Filter by type.",
                  enum=["episodic", "semantic", "preference", "procedural"]),
            Param("namespace", ParamType.STRING, "Filter by namespace."),
            Param("pinned", ParamType.BOOLEAN, "Filter by pinned status."),
        ],
    ),

    ToolDef(
        name="sulcus_forget",
        description=(
            "Permanently delete a memory by ID. Irreversible. Only call when the user "
            "explicitly asks to forget something."
        ),
        category="memory",
        params=[
            Param("memory_id", ParamType.STRING, "UUID of the memory to delete.",
                  required=True, format="uuid"),
        ],
    ),

    ToolDef(
        name="sulcus_update",
        description=(
            "Update fields on an existing memory. More surgical than forget+re-remember "
            "because it preserves history and graph edges."
        ),
        category="memory",
        params=[
            Param("memory_id", ParamType.STRING, "UUID of the memory to update.",
                  required=True, format="uuid"),
            Param("label", ParamType.STRING, "New short display label."),
            Param("memory_type", ParamType.STRING, "New type classification.",
                  enum=["episodic", "semantic", "preference", "procedural"]),
            Param("is_pinned", ParamType.BOOLEAN, "Pin (prevent decay) or unpin."),
            Param("heat", ParamType.NUMBER, "New heat value (0.0–100.0).",
                  minimum=0.0, maximum=100.0),
        ],
    ),

    # === Heat tools ===
    ToolDef(
        name="sulcus_boost",
        description="Boost a memory's heat to make it surface more prominently in recall.",
        category="heat",
        params=[
            Param("memory_id", ParamType.STRING, "UUID of the memory to boost.", required=True, format="uuid"),
            Param("amount", ParamType.NUMBER, "Heat increase (0.0–100.0).", minimum=0.0, maximum=100.0, default=20.0),
        ],
    ),

    ToolDef(
        name="sulcus_deprecate",
        description="Reduce a memory's heat to make it surface less often.",
        category="heat",
        params=[
            Param("memory_id", ParamType.STRING, "UUID of the memory to deprecate.", required=True, format="uuid"),
            Param("amount", ParamType.NUMBER, "Heat decrease (0.0–100.0).", minimum=0.0, maximum=100.0, default=20.0),
        ],
    ),

    ToolDef(
        name="sulcus_hot_nodes",
        description="List the hottest (most active) memories. Shows what's top-of-mind right now.",
        category="heat",
        params=[
            Param("limit", ParamType.INTEGER, "Max results.", minimum=1, maximum=50, default=10),
        ],
    ),

    # === Context tools ===
    ToolDef(
        name="sulcus_build_context",
        description=(
            "Build a token-budgeted context block from relevant memories. "
            "Returns formatted text suitable for injection into a system prompt."
        ),
        category="context",
        params=[
            Param("query", ParamType.STRING, "The current task or question.", required=True),
            Param("token_budget", ParamType.INTEGER, "Maximum tokens in the context block.",
                  minimum=100, maximum=10000, default=2000),
        ],
    ),

    # === Trigger tools ===
    ToolDef(
        name="sulcus_create_trigger",
        description=(
            "Create a reactive trigger that fires when memory conditions are met. "
            "For example: alert when a memory about a specific topic is stored."
        ),
        category="trigger",
        params=[
            Param("name", ParamType.STRING, "Trigger name.", required=True),
            Param("condition", ParamType.STRING,
                  "Trigger condition in Sulcus trigger syntax.", required=True),
            Param("action", ParamType.STRING,
                  "Action to take when trigger fires.", required=True),
        ],
    ),

    ToolDef(
        name="sulcus_list_triggers",
        description="List all active triggers.",
        category="trigger",
        params=[],
    ),

    ToolDef(
        name="sulcus_delete_trigger",
        description="Delete a trigger by ID.",
        category="trigger",
        params=[
            Param("trigger_id", ParamType.STRING, "UUID of the trigger to delete.", required=True),
        ],
    ),

    # === Graph tools ===
    ToolDef(
        name="sulcus_relate",
        description=(
            "Create a relationship between two memories in the knowledge graph. "
            "For example: link a person to a project, or a decision to its rationale."
        ),
        category="graph",
        params=[
            Param("source_id", ParamType.STRING, "UUID of the source memory.", required=True, format="uuid"),
            Param("target_id", ParamType.STRING, "UUID of the target memory.", required=True, format="uuid"),
            Param("relation", ParamType.STRING, "Relationship label (e.g. 'authored', 'depends_on').", required=True),
        ],
    ),

    ToolDef(
        name="sulcus_graph_traverse",
        description=(
            "Traverse the knowledge graph from a starting memory. Returns connected memories "
            "and their relationships."
        ),
        category="graph",
        params=[
            Param("memory_id", ParamType.STRING, "Starting memory UUID.", required=True, format="uuid"),
            Param("depth", ParamType.INTEGER, "Max traversal depth.", minimum=1, maximum=5, default=2),
        ],
    ),

    # === Auto-recall ===
    ToolDef(
        name="sulcus_auto_recall",
        description=(
            "Auto-recall: build a query-aware context block from relevant memories "
            "using semantic search + knowledge graph expansion + hot nodes. "
            "Returns formatted text suitable for system prompt injection. "
            "This is the recommended high-level context-building function."
        ),
        category="context",
        params=[
            Param("query", ParamType.STRING, "Current task, question, or conversation topic.", required=True),
            Param("token_budget", ParamType.INTEGER, "Maximum tokens in the context block.",
                  minimum=100, maximum=16000, default=4000),
            Param("graph_hops", ParamType.BOOLEAN,
                  "Enable graph-hop expansion from top search results.", default=True),
        ],
    ),

    # === Classification tools ===
    ToolDef(
        name="sulcus_classify",
        description=(
            "Classify text through the SIU v2 quality gate. Returns whether the text "
            "is worth storing as a memory, along with predicted memory type. "
            "Use this to pre-screen content before storing, or to understand "
            "how SULCUS would classify a piece of text."
        ),
        category="memory",
        params=[
            Param("text", ParamType.STRING, "Text to classify.", required=True),
        ],
    ),

    ToolDef(
        name="sulcus_auto_capture",
        description=(
            "Auto-capture: classify text through SIU v2 quality gate and store if worthy. "
            "Includes junk filtering, quality gating, and automatic memory type assignment. "
            "Use this for fire-and-forget capture of conversation content "
            "(user messages, assistant outputs, decisions, etc.)."
        ),
        category="context",
        params=[
            Param("text", ParamType.STRING, "Text content to evaluate and potentially store.", required=True),
            Param("source", ParamType.STRING,
                  "Source label for metadata tracking (e.g. 'gemini-agent', 'langchain-pipeline').",
                  default="auto-capture-python"),
        ],
    ),

    # === Guardrail tools ===
    ToolDef(
        name="sulcus_scan_pii",
        description=(
            "Scan text for personally identifiable information (PII). "
            "Detects emails, phone numbers, SSNs, credit cards, IP addresses, "
            "and API keys. Returns detected spans and a redacted version of the text. "
            "Use this to check content before sharing or storing."
        ),
        category="guardrails",
        params=[
            Param("text", ParamType.STRING, "Text to scan for PII.", required=True),
        ],
    ),

    # === Config tools ===
    ToolDef(
        name="sulcus_status",
        description="Get Sulcus server status including version, memory count, and configuration.",
        category="config",
        params=[],
    ),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_tools(categories: list[str] | None = None) -> list[ToolDef]:
    """Return tools, optionally filtered by category."""
    if categories is None:
        return TOOLS
    return [t for t in TOOLS if t.category in categories]


def get_core_tools() -> list[ToolDef]:
    """Return just the 5 core memory tools (remember, search, list, forget, update)."""
    return get_tools(["memory"])


def get_extended_tools() -> list[ToolDef]:
    """Return all tools including heat, context, triggers, graph, config."""
    return TOOLS
