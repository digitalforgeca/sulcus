"""SulcusChatMessageHistory — BaseChatMessageHistory backed by Sulcus.

Each chat message is stored as a Sulcus memory node with metadata that
records the message role, session ID, and original content. Messages are
retrieved by listing nodes in the ``chat_history`` namespace (or a custom
namespace) filtered by a session tag embedded in the pointer_summary.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Sequence

from langchain_core.chat_history import BaseChatMessageHistory
from langchain_core.messages import (
    BaseMessage,
    HumanMessage,
    AIMessage,
    SystemMessage,
    messages_from_dict,
    messages_to_dict,
)
from pydantic import Field

from sulcus import Sulcus


# ---------------------------------------------------------------------------
# Role helpers
# ---------------------------------------------------------------------------

ROLE_TO_MEMORY_TYPE: Dict[str, str] = {
    "human": "episodic",
    "ai": "episodic",
    "system": "semantic",
}

MSG_TAG_PREFIX = "__sulcus_chat__"


def _serialise_message(msg: BaseMessage, session_id: str, index: int) -> str:
    """Serialise a BaseMessage to a Sulcus pointer_summary string.

    The format is:
        ``__sulcus_chat__::<session_id>::<index>::<role>::<json_content>``

    This allows lossless round-trip reconstruction without extra metadata
    fields, since Sulcus currently stores only the label/pointer_summary.
    """
    role = msg.type  # "human", "ai", "system", "chat", etc.
    content = json.dumps(msg.content, ensure_ascii=False)
    return f"{MSG_TAG_PREFIX}::{session_id}::{index}::{role}::{content}"


def _deserialise_message(pointer_summary: str) -> Optional[BaseMessage]:
    """Parse a Sulcus pointer_summary back into a BaseMessage.

    Returns ``None`` if the string is not a recognised serialised message.
    """
    if not pointer_summary.startswith(MSG_TAG_PREFIX + "::"):
        return None

    parts = pointer_summary.split("::", 4)
    if len(parts) < 5:
        return None

    _, _session_id, _index, role, content_json = parts
    try:
        content = json.loads(content_json)
    except json.JSONDecodeError:
        content = content_json

    role_map = {
        "human": HumanMessage,
        "ai": AIMessage,
        "system": SystemMessage,
    }
    cls = role_map.get(role, HumanMessage)
    return cls(content=content)


# ---------------------------------------------------------------------------
# SulcusChatMessageHistory
# ---------------------------------------------------------------------------


class SulcusChatMessageHistory(BaseChatMessageHistory):
    """LangChain BaseChatMessageHistory backed by Sulcus memory nodes.

    Each message in the conversation is stored as a separate Sulcus memory
    node. Messages are scoped to a ``session_id`` so multiple conversations
    can coexist in the same namespace.

    Args:
        client: An initialised :class:`sulcus.Sulcus` instance.
        session_id: Unique identifier for this conversation thread.
        namespace: Sulcus namespace to store messages in. Defaults to the
            client's configured namespace.
        heat: Initial heat for stored message nodes (0.0–1.0).
        max_messages: If set, only the most recent N messages are returned.

    Example::

        from sulcus import Sulcus
        from sulcus_langchain import SulcusChatMessageHistory

        client = Sulcus(api_key="sk-...", namespace="chatbot")
        history = SulcusChatMessageHistory(client=client, session_id="user-42")
        history.add_user_message("Hello!")
        print(history.messages)
    """

    client: Any = Field(..., description="Initialised sulcus.Sulcus instance.")
    session_id: str
    namespace: Optional[str] = None
    heat: float = 0.7
    max_messages: Optional[int] = None

    class Config:
        arbitrary_types_allowed = True

    @property
    def messages(self) -> List[BaseMessage]:
        """Retrieve all messages for this session from Sulcus.

        Messages are fetched by searching for nodes whose pointer_summary
        contains the session tag prefix, then sorted by their embedded index.

        Returns:
            Ordered list of :class:`langchain_core.messages.BaseMessage`.
        """
        ns = self.namespace or self.client.namespace
        raw_nodes = self.client.list(
            page_size=200,
            namespace=ns,
            sort="updated_at",
            order="asc",
        )

        parsed: List[tuple[int, BaseMessage]] = []
        session_prefix = f"{MSG_TAG_PREFIX}::{self.session_id}::"

        for node in raw_nodes:
            summary = node.pointer_summary
            if not summary.startswith(session_prefix):
                continue
            parts = summary.split("::", 4)
            if len(parts) < 5:
                continue
            try:
                index = int(parts[2])
            except ValueError:
                index = 0
            msg = _deserialise_message(summary)
            if msg is not None:
                parsed.append((index, msg))

        # Sort by embedded index for correct ordering
        parsed.sort(key=lambda t: t[0])
        ordered = [msg for _, msg in parsed]

        if self.max_messages is not None:
            ordered = ordered[-self.max_messages:]

        return ordered

    def add_message(self, message: BaseMessage) -> None:
        """Store a single message as a Sulcus memory node.

        The message index is derived from the current length of the history
        to maintain insertion order on retrieval.

        Args:
            message: Any :class:`langchain_core.messages.BaseMessage` subclass.
        """
        ns = self.namespace or self.client.namespace
        current_count = len(self.messages)
        pointer = _serialise_message(message, self.session_id, current_count)
        memory_type = ROLE_TO_MEMORY_TYPE.get(message.type, "episodic")

        self.client.remember(
            pointer,
            memory_type=memory_type,
            heat=self.heat,
            namespace=ns,
        )

    def add_user_message(self, message: str) -> None:
        """Convenience wrapper to add a human message.

        Args:
            message: The user's message text.
        """
        self.add_message(HumanMessage(content=message))

    def add_ai_message(self, message: str) -> None:
        """Convenience wrapper to add an AI response message.

        Args:
            message: The AI's response text.
        """
        self.add_message(AIMessage(content=message))

    def clear(self) -> None:
        """Delete all messages for this session from Sulcus.

        Only nodes belonging to this ``session_id`` are removed. Other
        sessions in the same namespace are unaffected.
        """
        ns = self.namespace or self.client.namespace
        session_prefix = f"{MSG_TAG_PREFIX}::{self.session_id}::"
        page = 1
        while True:
            nodes = self.client.list(
                page=page,
                page_size=100,
                namespace=ns,
            )
            if not nodes:
                break
            for node in nodes:
                if node.pointer_summary.startswith(session_prefix):
                    self.client.forget(node.id)
            if len(nodes) < 100:
                break
            page += 1
