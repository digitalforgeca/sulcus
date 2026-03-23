"""SulcusReader — load Sulcus memories as LlamaIndex Documents."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from llama_index.core.readers.base import BaseReader
from llama_index.core.schema import Document

from sulcus import Sulcus, Memory


class SulcusReader(BaseReader):
    """LlamaIndex ``BaseReader`` that loads Sulcus memories as ``Document`` objects.

    Supports filtering by memory type, namespace, and pinned status.
    Suitable as an ingestion source for building a LlamaIndex pipeline
    directly from an existing Sulcus knowledge graph.

    Args:
        api_key: Sulcus API key (``sk-...``).
        base_url: Sulcus server URL. Defaults to the Sulcus Cloud endpoint.
        namespace: Default namespace to query. Defaults to ``"default"``.
        timeout: HTTP timeout in seconds.

    Example::

        from sulcus_llamaindex import SulcusReader

        reader = SulcusReader(api_key="sk-...")
        docs = reader.load_data(memory_type="semantic", namespace="research")
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = Sulcus.DEFAULT_URL,
        namespace: str = "default",
        timeout: int = 30,
    ) -> None:
        self._client = Sulcus(
            api_key=api_key,
            base_url=base_url,
            namespace=namespace,
            timeout=timeout,
        )
        self._namespace = namespace

    def load_data(
        self,
        *,
        memory_type: Optional[str] = None,
        namespace: Optional[str] = None,
        pinned: Optional[bool] = None,
        search: Optional[str] = None,
        page_size: int = 100,
        max_pages: int = 10,
        **load_kwargs: Any,
    ) -> List[Document]:
        """Load Sulcus memories and return them as LlamaIndex ``Document`` objects.

        Each Sulcus ``Memory`` node becomes one ``Document``. The ``pointer_summary``
        field is used as the document text. All Sulcus metadata (heat, type,
        namespace, pinned status, modality) is preserved in ``doc.metadata``.

        Args:
            memory_type: Filter by Sulcus memory type (``episodic``, ``semantic``,
                ``preference``, ``procedural``). No filter when ``None``.
            namespace: Override the store's default namespace.
            pinned: When ``True`` return only pinned memories; ``False`` for
                unpinned only; ``None`` for all.
            search: Optional substring search filter (applied server-side).
            page_size: Number of memories to fetch per page (max 100).
            max_pages: Upper bound on pages fetched to prevent runaway queries.

        Returns:
            List of ``Document`` objects with text and Sulcus metadata.
        """
        ns = namespace or self._namespace
        documents: List[Document] = []

        for page in range(1, max_pages + 1):
            memories = self._client.list(
                page=page,
                page_size=page_size,
                memory_type=memory_type,
                namespace=ns,
                pinned=pinned,
                search=search,
            )

            if not memories:
                break

            for mem in memories:
                documents.append(self._memory_to_document(mem))

            # If we got fewer than page_size, this is the last page.
            if len(memories) < page_size:
                break

        return documents

    def load_pinned(self, namespace: Optional[str] = None) -> List[Document]:
        """Convenience method: load only pinned (heat-preserved) memories.

        Args:
            namespace: Override the store's default namespace.

        Returns:
            List of ``Document`` objects for pinned memories.
        """
        return self.load_data(pinned=True, namespace=namespace)

    def load_by_type(
        self, memory_type: str, namespace: Optional[str] = None
    ) -> List[Document]:
        """Convenience method: load memories of a specific type.

        Args:
            memory_type: One of ``episodic``, ``semantic``, ``preference``,
                ``procedural``.
            namespace: Override the store's default namespace.

        Returns:
            List of ``Document`` objects filtered by type.
        """
        return self.load_data(memory_type=memory_type, namespace=namespace)

    def search(self, query: str, limit: int = 20) -> List[Document]:
        """Search Sulcus and return results as LlamaIndex ``Document`` objects.

        This is a thin convenience wrapper around the Sulcus search endpoint.
        For full RAG pipelines, prefer ``SulcusVectorStore`` which integrates
        directly with the LlamaIndex query engine.

        Args:
            query: Free-text search query.
            limit: Maximum number of results to return.

        Returns:
            List of ``Document`` objects sorted by relevance (heat).
        """
        memories = self._client.search(query=query, limit=limit)
        return [self._memory_to_document(mem) for mem in memories]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _memory_to_document(mem: Memory) -> Document:
        """Convert a Sulcus ``Memory`` node to a LlamaIndex ``Document``.

        Args:
            mem: The Sulcus ``Memory`` instance to convert.

        Returns:
            A ``Document`` with the memory text and full Sulcus metadata.
        """
        return Document(
            text=mem.pointer_summary,
            doc_id=mem.id,
            metadata={
                "sulcus_id": mem.id,
                "memory_type": mem.memory_type,
                "heat": mem.current_heat,
                "base_utility": mem.base_utility,
                "is_pinned": mem.is_pinned,
                "modality": mem.modality,
                "namespace": mem.namespace,
            },
        )
