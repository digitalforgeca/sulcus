"""MemBench adapters for LangChain memory types.

Requires: pip install membench[langchain]
"""

from __future__ import annotations

import os

from ..adapter import MemoryAdapter, Message, MemoryStats


class LangChainBufferAdapter(MemoryAdapter):
    """LangChain ConversationBufferMemory — keeps everything."""

    def __init__(self):
        try:
            from langchain.memory import ConversationBufferMemory
        except ImportError:
            raise ImportError("LangChain adapter requires: pip install langchain langchain-openai")
        self._memory = ConversationBufferMemory(return_messages=True)

    @property
    def name(self) -> str:
        return "LangChain Buffer"

    @property
    def version(self) -> str:
        try:
            import langchain
            return langchain.__version__
        except Exception:
            return "unknown"

    def reset(self) -> None:
        self._memory.clear()

    def ingest(self, messages: list[Message]) -> None:
        i = 0
        while i < len(messages):
            if messages[i].role == "user":
                user_msg = messages[i].content
                ai_msg = messages[i + 1].content if i + 1 < len(messages) and messages[i + 1].role == "assistant" else ""
                self._memory.save_context({"input": user_msg}, {"output": ai_msg})
                i += 2
            else:
                i += 1

    def query(self, question: str) -> str:
        vars = self._memory.load_memory_variables({})
        history = vars.get("history", "")
        if isinstance(history, list):
            return "\n".join(str(m.content) for m in history)
        return str(history)

    def get_stats(self) -> MemoryStats:
        context = self.query("")
        return MemoryStats(
            context_bytes=len(context.encode()),
            node_count=len(self._memory.chat_memory.messages),
        )


class LangChainSummaryAdapter(MemoryAdapter):
    """LangChain ConversationSummaryMemory — LLM-summarized."""

    def __init__(self, model: str = "gpt-4o-mini"):
        try:
            from langchain.memory import ConversationSummaryMemory
            from langchain_openai import ChatOpenAI
        except ImportError:
            raise ImportError("LangChain adapter requires: pip install langchain langchain-openai")

        api_key = os.environ.get("OPENAI_API_KEY", "")
        llm = ChatOpenAI(model=model, openai_api_key=api_key, temperature=0)
        self._memory = ConversationSummaryMemory(llm=llm, return_messages=True)
        self._model = model

    @property
    def name(self) -> str:
        return f"LangChain Summary ({self._model})"

    @property
    def version(self) -> str:
        try:
            import langchain
            return langchain.__version__
        except Exception:
            return "unknown"

    def reset(self) -> None:
        self._memory.clear()

    def ingest(self, messages: list[Message]) -> None:
        i = 0
        while i < len(messages):
            if messages[i].role == "user":
                user_msg = messages[i].content
                ai_msg = messages[i + 1].content if i + 1 < len(messages) and messages[i + 1].role == "assistant" else ""
                self._memory.save_context({"input": user_msg}, {"output": ai_msg})
                i += 2
            else:
                i += 1

    def query(self, question: str) -> str:
        vars = self._memory.load_memory_variables({})
        history = vars.get("history", "")
        if isinstance(history, list):
            return "\n".join(str(m.content) for m in history)
        return str(history)

    def get_stats(self) -> MemoryStats:
        context = self.query("")
        return MemoryStats(
            context_bytes=len(context.encode()),
            node_count=1,  # summary is a single node
        )
