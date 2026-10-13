"""sulcus-langchain — LangChain memory backend for Sulcus autonomous memory & semantic VMMU."""

from sulcus_langchain.memory import SulcusMemory
from sulcus_langchain.chat_memory import SulcusChatMessageHistory
from sulcus_langchain.retriever import SulcusRetriever
from sulcus_langchain.graph import SulcusMemoryNode, get_sulcus_tools
from sulcus_langchain.callbacks import SulcusCallbackHandler

try:
    from sulcus_langchain.saver import SulcusSaver
except ImportError:
    SulcusSaver = None  # type: ignore[assignment,misc]

__all__ = [
    "SulcusMemory",
    "SulcusChatMessageHistory",
    "SulcusRetriever",
    "SulcusSaver",
    "SulcusMemoryNode",
    "get_sulcus_tools",
    "SulcusCallbackHandler",
]
__version__ = "0.1.0"
