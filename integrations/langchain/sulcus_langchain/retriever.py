"""SulcusRetriever — LangChain BaseRetriever backed by Sulcus search.

Wraps the Sulcus ``search`` endpoint as a LangChain-compatible retriever.
Returns :class:`langchain_core.documents.Document` objects enriched with
Sulcus metadata (memory_type, heat, namespace, memory_id).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from langchain_core.callbacks import CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from pydantic import Field

from sulcus import Sulcus


class SulcusRetriever(BaseRetriever):
    """LangChain BaseRetriever that queries Sulcus for relevant memories.

    Performs a semantic (currently substring) search against the Sulcus
    golden index and returns results as :class:`langchain_core.documents.Document`
    objects. Each document carries Sulcus metadata so downstream chains can
    reason about memory provenance and thermodynamic heat.

    Args:
        client: An initialised :class:`sulcus.Sulcus` instance.
        search_limit: Maximum number of memories to return per query.
        memory_type: If set, filter results to a specific Sulcus memory type
            (``"episodic"``, ``"semantic"``, ``"preference"``, ``"procedural"``).
        namespace: If set, restrict search to this namespace. Defaults to the
            client's namespace.
        min_heat: Minimum ``current_heat`` threshold. Memories below this
            value are filtered out post-retrieval. Useful for pruning cold
            (low-relevance) memories.

    Example::

        from sulcus import Sulcus
        from sulcus_langchain import SulcusRetriever

        client = Sulcus(api_key="sk-...", namespace="kb")
        retriever = SulcusRetriever(client=client, search_limit=5)

        docs = retriever.get_relevant_documents("What is photosynthesis?")
        for doc in docs:
            print(doc.page_content, doc.metadata)
    """

    client: Any = Field(..., description="Initialised sulcus.Sulcus instance.")
    search_limit: int = 10
    memory_type: Optional[str] = None
    namespace: Optional[str] = None
    min_heat: float = 0.0

    class Config:
        arbitrary_types_allowed = True

    def _get_relevant_documents(
        self,
        query: str,
        *,
        run_manager: CallbackManagerForRetrieverRun,
    ) -> List[Document]:
        """Search Sulcus for memories relevant to *query*.

        Calls the Sulcus ``search`` endpoint and converts each :class:`sulcus.Memory`
        node to a :class:`langchain_core.documents.Document`. Filters by
        ``min_heat`` if configured.

        Args:
            query: The search string. Passed directly to Sulcus search.
            run_manager: LangChain callback manager (injected by the framework).

        Returns:
            List of :class:`langchain_core.documents.Document` sorted by heat
            descending (hottest memories first).
        """
        ns = self.namespace or self.client.namespace

        memories = self.client.search(
            query,
            limit=self.search_limit,
            memory_type=self.memory_type,
            namespace=ns,
        )

        documents: List[Document] = []
        for mem in memories:
            if mem.current_heat < self.min_heat:
                continue

            metadata: Dict[str, Any] = {
                "memory_id": mem.id,
                "memory_type": mem.memory_type,
                "heat": mem.current_heat,
                "base_utility": mem.base_utility,
                "namespace": mem.namespace,
                "is_pinned": mem.is_pinned,
                "modality": mem.modality,
            }

            documents.append(
                Document(
                    page_content=mem.pointer_summary,
                    metadata=metadata,
                )
            )

        # Sort by heat descending (highest relevance first)
        documents.sort(key=lambda d: d.metadata.get("heat", 0.0), reverse=True)
        return documents

    async def _aget_relevant_documents(
        self,
        query: str,
        *,
        run_manager: CallbackManagerForRetrieverRun,
    ) -> List[Document]:
        """Async variant. Falls back to the sync implementation.

        For true async support, replace ``self.client`` with an
        :class:`sulcus.AsyncSulcus` instance and ``await`` the search call.

        Args:
            query: The search string.
            run_manager: LangChain callback manager.

        Returns:
            List of :class:`langchain_core.documents.Document`.
        """
        # Async path: use AsyncSulcus if available, else fall back
        if hasattr(self.client, "__aenter__"):
            memories = await self.client.search(
                query,
                limit=self.search_limit,
                memory_type=self.memory_type,
                namespace=self.namespace or self.client.namespace,
            )
            documents: List[Document] = []
            for mem in memories:
                if mem.current_heat < self.min_heat:
                    continue
                metadata: Dict[str, Any] = {
                    "memory_id": mem.id,
                    "memory_type": mem.memory_type,
                    "heat": mem.current_heat,
                    "base_utility": mem.base_utility,
                    "namespace": mem.namespace,
                    "is_pinned": mem.is_pinned,
                    "modality": mem.modality,
                }
                documents.append(Document(page_content=mem.pointer_summary, metadata=metadata))
            documents.sort(key=lambda d: d.metadata.get("heat", 0.0), reverse=True)
            return documents

        # Fallback: sync client in async context
        return self._get_relevant_documents(query, run_manager=run_manager)
