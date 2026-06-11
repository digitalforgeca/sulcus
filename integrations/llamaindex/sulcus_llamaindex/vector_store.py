"""SulcusVectorStore — LlamaIndex BasePydanticVectorStore backed by Sulcus memory."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, cast

from llama_index.core.schema import BaseNode, TextNode
from llama_index.core.vector_stores.types import (
    BasePydanticVectorStore,
    VectorStoreQuery,
    VectorStoreQueryResult,
)

from sulcus import Sulcus


# ---------------------------------------------------------------------------
# Metadata helpers
# ---------------------------------------------------------------------------

_MEMORY_TYPES = {"episodic", "semantic", "preference", "procedural", "fact", "synthesis", "moment"}
_DEFAULT_MEMORY_TYPE = "semantic"
_DEFAULT_HEAT = 0.8


def _memory_type_from_meta(metadata: Dict[str, Any]) -> str:
    """Extract and validate memory_type from LlamaIndex node metadata."""
    mt = metadata.get("memory_type", _DEFAULT_MEMORY_TYPE)
    return mt if mt in _MEMORY_TYPES else _DEFAULT_MEMORY_TYPE


def _heat_from_meta(metadata: Dict[str, Any]) -> float:
    """Extract heat value (0.0–1.0) from LlamaIndex node metadata."""
    raw = metadata.get("heat", _DEFAULT_HEAT)
    try:
        return max(0.0, min(1.0, float(raw)))
    except (TypeError, ValueError):
        return _DEFAULT_HEAT


def _namespace_from_meta(metadata: Dict[str, Any], default: str) -> str:
    """Extract namespace from metadata, falling back to store default."""
    return str(metadata.get("namespace", default))


# ---------------------------------------------------------------------------
# Vector Store
# ---------------------------------------------------------------------------


class SulcusVectorStore(BasePydanticVectorStore):
    """LlamaIndex vector store backed by Sulcus reactive, thermodynamic memory.

    Stores each LlamaIndex node as a Sulcus memory node using the node's
    text content as the ``pointer_summary``. Metadata fields ``memory_type``,
    ``heat``, and ``namespace`` are mapped to Sulcus fields.

    Similarity search is performed via the Sulcus ``/search`` endpoint
    (substring / semantic matching sorted by heat).

    Args:
        api_key: Sulcus API key (``sk-...``).
        base_url: Sulcus server URL. Defaults to the Sulcus Cloud endpoint.
        namespace: Default namespace for all nodes stored through this store.
        timeout: HTTP request timeout in seconds.

    Example::

        from sulcus_llamaindex import SulcusVectorStore

        store = SulcusVectorStore(api_key="sk-...")
        storage_context = StorageContext.from_defaults(vector_store=store)
        index = VectorStoreIndex.from_documents(docs, storage_context=storage_context)
    """

    # Pydantic fields — these are serialised by LlamaIndex's storage layer.
    stores_text: bool = True
    flat_metadata: bool = True

    api_key: str
    base_url: str
    namespace: str
    timeout: int

    # Private client — excluded from Pydantic model.
    _client: Optional[Sulcus] = None

    class Config:
        arbitrary_types_allowed = True

    def __init__(
        self,
        api_key: str,
        base_url: str = Sulcus.DEFAULT_URL,
        namespace: str = "default",
        timeout: int = 30,
        **kwargs: Any,
    ) -> None:
        super().__init__(
            api_key=api_key,
            base_url=base_url,
            namespace=namespace,
            timeout=timeout,
            **kwargs,
        )

    @property
    def client(self) -> Sulcus:
        """Lazily initialised Sulcus client."""
        if self._client is None:
            object.__setattr__(
                self,
                "_client",
                Sulcus(
                    api_key=self.api_key,
                    base_url=self.base_url,
                    namespace=self.namespace,
                    timeout=self.timeout,
                ),
            )
        return cast(Sulcus, self._client)

    @classmethod
    def class_name(cls) -> str:
        """LlamaIndex class name identifier."""
        return "SulcusVectorStore"

    # ------------------------------------------------------------------
    # BasePydanticVectorStore interface
    # ------------------------------------------------------------------

    def add(self, nodes: List[BaseNode], **add_kwargs: Any) -> List[str]:
        """Store a list of LlamaIndex nodes as Sulcus memory nodes.

        Each node's text is stored as ``pointer_summary``. The following
        metadata keys are mapped to Sulcus fields:

        - ``memory_type`` — one of ``episodic``, ``semantic``,
          ``preference``, ``procedural`` (default: ``semantic``)
        - ``heat`` — float 0.0–1.0 (default: 0.8)
        - ``namespace`` — string (default: store namespace)

        The Sulcus node ID is written back into ``node.id_`` so that the
        LlamaIndex → Sulcus ID mapping is preserved.

        Args:
            nodes: LlamaIndex ``BaseNode`` instances to store.

        Returns:
            List of Sulcus memory IDs (strings).
        """
        ids: List[str] = []
        for node in nodes:
            metadata = node.metadata or {}
            text = node.get_content() if hasattr(node, "get_content") else str(node)

            memory = self.client.remember(
                content=text,
                memory_type=_memory_type_from_meta(metadata),
                heat=_heat_from_meta(metadata),
                namespace=_namespace_from_meta(metadata, self.namespace),
            )

            # Preserve bidirectional ID mapping in node metadata.
            node.metadata["sulcus_id"] = memory.id
            ids.append(memory.id)

        return ids

    def delete(self, ref_doc_id: str, **delete_kwargs: Any) -> None:
        """Delete a Sulcus memory node by its ID.

        Args:
            ref_doc_id: Sulcus memory ID to delete.
        """
        self.client.forget(ref_doc_id)

    def query(
        self, query: VectorStoreQuery, **kwargs: Any
    ) -> VectorStoreQueryResult:
        """Search Sulcus and return a LlamaIndex ``VectorStoreQueryResult``.

        Uses the Sulcus ``/search`` endpoint. Results are ordered by heat
        (thermodynamic relevance). Filters for ``memory_type`` and
        ``namespace`` are applied when present in ``query.filters``.

        Args:
            query: LlamaIndex ``VectorStoreQuery`` with ``query_str``,
                ``similarity_top_k``, and optional ``filters``.

        Returns:
            ``VectorStoreQueryResult`` with matched nodes and similarity scores.
        """
        query_str = query.query_str or ""
        top_k = query.similarity_top_k or 5

        # Extract optional filter values from LlamaIndex MetadataFilters.
        memory_type: Optional[str] = None
        namespace: Optional[str] = None

        if query.filters:
            for f in query.filters.filters:
                if f.key == "memory_type":
                    memory_type = str(f.value)
                elif f.key == "namespace":
                    namespace = str(f.value)

        memories = self.client.search(
            query=query_str,
            limit=top_k,
            memory_type=memory_type,
            namespace=namespace or self.namespace,
        )

        nodes: List[TextNode] = []
        similarities: List[float] = []
        node_ids: List[str] = []

        for mem in memories:
            node = TextNode(
                text=mem.pointer_summary,
                id_=mem.id,
                metadata={
                    "sulcus_id": mem.id,
                    "memory_type": mem.memory_type,
                    "heat": mem.current_heat,
                    "namespace": mem.namespace,
                    "is_pinned": mem.is_pinned,
                    "modality": mem.modality,
                    "base_utility": mem.base_utility,
                },
            )
            nodes.append(node)
            # Normalise heat (0–1) as the similarity score.
            similarities.append(min(1.0, max(0.0, mem.current_heat)))
            node_ids.append(mem.id)

        return VectorStoreQueryResult(
            nodes=nodes,
            similarities=similarities,
            ids=node_ids,
        )
