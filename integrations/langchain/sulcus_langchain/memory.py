"""SulcusMemory — LangChain BaseMemory implementation backed by Sulcus.

Maps LangChain memory_type strings to Sulcus memory_type constants:
  - "conversation" → "episodic"
  - "facts"        → "semantic"
  - "preferences"  → "preference"
  - "procedures"   → "procedural"
  - anything else  → passed through as-is
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from langchain_core.memory import BaseMemory
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, get_buffer_string
from pydantic import Field, model_validator

from sulcus import Sulcus


# ---------------------------------------------------------------------------
# Type mapping
# ---------------------------------------------------------------------------

MEMORY_TYPE_MAP: Dict[str, str] = {
    "conversation": "episodic",
    "facts": "semantic",
    "preferences": "preference",
    "procedures": "procedural",
}


def _map_memory_type(memory_type: str) -> str:
    """Map a LangChain-style memory type string to a Sulcus memory_type."""
    return MEMORY_TYPE_MAP.get(memory_type, memory_type)


# ---------------------------------------------------------------------------
# SulcusMemory
# ---------------------------------------------------------------------------


class SulcusMemory(BaseMemory):
    """LangChain BaseMemory implementation backed by Sulcus.

    Stores and retrieves conversation context through the Sulcus thermodynamic
    memory API. Each save creates one or two memory nodes (human turn + AI
    response). Loading searches Sulcus for the most relevant memories given
    the current input and returns them as a formatted string or message list.

    Args:
        client: An initialised :class:`sulcus.Sulcus` instance.
        memory_key: The key used to inject memories into the chain's prompt
            variables (default ``"history"``).
        input_key: The chain variable containing the human's latest message.
            If ``None``, the first key in the inputs dict is used.
        memory_type: LangChain-style type label. Mapped to Sulcus types via
            ``MEMORY_TYPE_MAP`` (e.g. ``"conversation"`` → ``"episodic"``).
        search_limit: Max memories returned by ``load_memory_variables``.
        heat: Initial heat assigned to newly stored memories (0.0–1.0).
        return_messages: When ``True`` returns a ``List[BaseMessage]`` instead
            of a formatted string. Useful for chat models.
        human_prefix: Prefix label used when ``return_messages=False``.
        ai_prefix: Prefix label used when ``return_messages=False``.

    Example::

        from sulcus import Sulcus
        from sulcus_langchain import SulcusMemory

        client = Sulcus(api_key="sk-...", namespace="my-app")
        memory = SulcusMemory(client=client, memory_type="conversation")
    """

    # Pydantic fields
    client: Any = Field(..., description="Initialised sulcus.Sulcus instance.")
    memory_key: str = "history"
    input_key: Optional[str] = None
    memory_type: str = "conversation"
    search_limit: int = 10
    heat: float = 0.8
    return_messages: bool = False
    human_prefix: str = "Human"
    ai_prefix: str = "AI"

    class Config:
        arbitrary_types_allowed = True

    @property
    def memory_variables(self) -> List[str]:
        """Return the list of variables this memory provides to the chain."""
        return [self.memory_key]

    def _sulcus_memory_type(self) -> str:
        return _map_memory_type(self.memory_type)

    def load_memory_variables(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Fetch relevant memories from Sulcus and return them as chain variables.

        Uses the latest human input as the search query against Sulcus.
        Results are sorted by heat (most thermodynamically active first).

        Args:
            inputs: The chain's current input dict. The human message is
                extracted via ``input_key`` or the first key found.

        Returns:
            A dict mapping ``memory_key`` to either a formatted string or
            a list of :class:`langchain_core.messages.BaseMessage` objects,
            depending on ``return_messages``.
        """
        # Determine query from inputs
        query = self._extract_input(inputs)

        if not query:
            if self.return_messages:
                return {self.memory_key: []}
            return {self.memory_key: ""}

        memories = self.client.search(
            query,
            limit=self.search_limit,
            memory_type=self._sulcus_memory_type(),
        )

        if not memories:
            if self.return_messages:
                return {self.memory_key: []}
            return {self.memory_key: ""}

        if self.return_messages:
            messages: List[BaseMessage] = []
            for mem in memories:
                messages.append(HumanMessage(content=mem.pointer_summary))
            return {self.memory_key: messages}

        # Format as readable string
        lines = [f"[{m.memory_type}] {m.pointer_summary}" for m in memories]
        return {self.memory_key: "\n".join(lines)}

    def save_context(self, inputs: Dict[str, Any], outputs: Dict[str, Any]) -> None:
        """Store a conversation turn as Sulcus memory nodes.

        Creates one memory node for the human input and one for the AI
        response, both tagged with the configured ``memory_type``.

        Args:
            inputs: The chain's input dict for this turn.
            outputs: The chain's output dict for this turn.
        """
        human_text = self._extract_input(inputs)
        ai_text = self._extract_output(outputs)

        sulcus_type = self._sulcus_memory_type()

        if human_text:
            self.client.remember(
                f"{self.human_prefix}: {human_text}",
                memory_type=sulcus_type,
                heat=self.heat,
            )

        if ai_text:
            self.client.remember(
                f"{self.ai_prefix}: {ai_text}",
                memory_type=sulcus_type,
                heat=self.heat,
            )

    def clear(self) -> None:
        """Clear memories in the client's namespace (lists and deletes all nodes).

        This is a destructive operation scoped to the current namespace and
        the configured memory type. Use with caution.
        """
        sulcus_type = self._sulcus_memory_type()
        page = 1
        while True:
            memories = self.client.list(
                page=page,
                page_size=100,
                memory_type=sulcus_type,
            )
            if not memories:
                break
            for mem in memories:
                self.client.forget(mem.id)
            if len(memories) < 100:
                break
            page += 1

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _extract_input(self, inputs: Dict[str, Any]) -> str:
        """Extract the human input string from the inputs dict."""
        if self.input_key and self.input_key in inputs:
            val = inputs[self.input_key]
        elif inputs:
            val = next(iter(inputs.values()))
        else:
            return ""
        return str(val) if val is not None else ""

    def _extract_output(self, outputs: Dict[str, Any]) -> str:
        """Extract the AI output string from the outputs dict."""
        # Common keys used by LangChain chains
        for key in ("output", "response", "answer", "text", "result"):
            if key in outputs:
                return str(outputs[key])
        if outputs:
            return str(next(iter(outputs.values())))
        return ""
