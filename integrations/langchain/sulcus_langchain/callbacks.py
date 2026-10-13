"""SulcusCallbackHandler — turnkey LangChain lifecycle callback for Sulcus memory."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage

from sulcus import Sulcus


class SulcusCallbackHandler(BaseCallbackHandler):
    """LangChain callback handler that automatically recalls and captures Sulcus memories.

    Lifecycle:
      - on_chat_model_start: Recalls memories via `client.build_context(query)`
        and injects the `<sulcus_context>` envelope into the system prompt.
      - on_chain_end: Captures final human/AI turns to Sulcus via `client.remember(..., memory_type='episodic')`.

    Args:
        client: Initialized `Sulcus` instance.
        namespace: Target namespace (defaults to client namespace).
        token_budget: Maximum tokens allocated for injected context (default: 2000).
        auto_capture: Whether to automatically store turns on chain end (default: True).
        min_heat: Minimum heat threshold for recalled memories.
    """

    def __init__(
        self,
        client: Sulcus,
        *,
        namespace: Optional[str] = None,
        token_budget: int = 2000,
        auto_capture: bool = True,
        min_heat: Optional[float] = None,
    ) -> None:
        super().__init__()
        self.client = client
        self.namespace = namespace or client.namespace
        self.token_budget = token_budget
        self.auto_capture = auto_capture
        self.min_heat = min_heat
        self._last_query: Optional[str] = None

    def on_chat_model_start(
        self,
        serialized: Dict[str, Any],
        messages: List[List[BaseMessage]],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Inject `<sulcus_context>` into the model's message list prior to invocation."""
        if not messages or not messages[0]:
            return

        batch_messages = messages[0]
        # Find latest human query
        query = ""
        for m in reversed(batch_messages):
            if isinstance(m, HumanMessage) and isinstance(m.content, str):
                query = m.content
                break

        self._last_query = query
        try:
            context = self.client.build_context(
                query=query,
                token_budget=self.token_budget,
                namespace=self.namespace,
                min_heat=self.min_heat,
            )
        except Exception:
            return

        # Prepend or inject into system message
        injected = False
        for idx, m in enumerate(batch_messages):
            if isinstance(m, SystemMessage):
                original_content = m.content if isinstance(m.content, str) else str(m.content)
                if "<sulcus_context" not in original_content:
                    batch_messages[idx] = SystemMessage(
                        content=f"{original_content}\n\n{context}"
                    )
                injected = True
                break

        if not injected:
            batch_messages.insert(0, SystemMessage(content=context))

    def on_chain_end(
        self,
        outputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Capture the exchange into Sulcus memory on chain completion."""
        if not self.auto_capture or not self._last_query:
            return

        # Extract text response from output
        output_text = ""
        if isinstance(outputs, dict):
            for key in ("output", "response", "answer", "text", "result"):
                if key in outputs and isinstance(outputs[key], str):
                    output_text = outputs[key]
                    break
            if not output_text and outputs:
                first_val = next(iter(outputs.values()))
                if isinstance(first_val, str):
                    output_text = first_val
                elif hasattr(first_val, "content") and isinstance(first_val.content, str):
                    output_text = first_val.content
        elif isinstance(outputs, str):
            output_text = outputs

        if output_text:
            exchange = f"User: {self._last_query}\nAI: {output_text}"
            try:
                self.client.remember(
                    content=exchange,
                    memory_type="episodic",
                    heat=0.8,
                    namespace=self.namespace,
                    train_on_this=True,
                )
            except Exception:
                pass
