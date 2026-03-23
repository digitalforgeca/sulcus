"""SulcusDocumentStore — KV-style LlamaIndex document persistence via Sulcus."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Sequence

from llama_index.core.schema import BaseNode, TextNode
from llama_index.core.storage.docstore.types import BaseDocumentStore
from llama_index.core.storage.kvstore.types import DEFAULT_COLLECTION

from sulcus import Sulcus, Memory


# Sulcus namespace prefix for document-store entries, keeping them separated
# from raw vector-store memories within the same account.
_DOC_NAMESPACE_PREFIX = "docstore"


def _doc_namespace(collection: str) -> str:
    return f"{_DOC_NAMESPACE_PREFIX}:{collection}"


def _encode_node(node: BaseNode) -> str:
    """Serialise a LlamaIndex node to a compact JSON string."""
    return json.dumps(node.to_dict())


def _decode_node(raw: str) -> BaseNode:
    """Deserialise a LlamaIndex node from the stored JSON string."""
    data = json.loads(raw)
    # TextNode covers the common case; delegate to from_dict for polymorphism.
    return TextNode.from_dict(data)


class SulcusDocumentStore(BaseDocumentStore):
    """LlamaIndex document store backed by Sulcus memory.

    Documents are serialised to JSON and stored as Sulcus memory nodes
    (type ``procedural``) in a dedicated namespace so they don't pollute
    the semantic memory graph.

    Args:
        api_key: Sulcus API key.
        base_url: Sulcus server URL.
        namespace: Logical collection name (default ``"default"``).
        timeout: HTTP timeout in seconds.

    Example::

        from sulcus_llamaindex import SulcusDocumentStore

        doc_store = SulcusDocumentStore(api_key="sk-...")
        storage_context = StorageContext.from_defaults(docstore=doc_store)
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = Sulcus.DEFAULT_URL,
        namespace: str = DEFAULT_COLLECTION,
        timeout: int = 30,
    ) -> None:
        self._client = Sulcus(
            api_key=api_key,
            base_url=base_url,
            namespace=_doc_namespace(namespace),
            timeout=timeout,
        )
        self._namespace = namespace

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _find_by_doc_id(self, doc_id: str) -> Optional[Memory]:
        """Find the Sulcus memory node whose pointer_summary begins with the
        doc ID sentinel.  Returns ``None`` if not found."""
        sentinel = f"__doc_id__:{doc_id}:"
        memories = self._client.search(query=doc_id, limit=10)
        for mem in memories:
            if mem.pointer_summary.startswith(sentinel):
                return mem
        return None

    def _encode_content(self, doc_id: str, node: BaseNode) -> str:
        """Encode node content prefixed with a doc-ID sentinel for retrieval."""
        return f"__doc_id__:{doc_id}:{_encode_node(node)}"

    # ------------------------------------------------------------------
    # BaseDocumentStore interface
    # ------------------------------------------------------------------

    def add_documents(
        self,
        docs: Sequence[BaseNode],
        allow_update: bool = True,
        store_text: bool = True,
    ) -> None:
        """Persist a sequence of LlamaIndex nodes to Sulcus.

        Existing nodes with the same ID are deleted before re-insertion when
        ``allow_update`` is ``True`` (default).

        Args:
            docs: Nodes to persist.
            allow_update: When True, overwrite existing nodes with the same ID.
            store_text: Unused compatibility shim (text is always stored).
        """
        for node in docs:
            doc_id = node.node_id

            if allow_update:
                existing = self._find_by_doc_id(doc_id)
                if existing:
                    self._client.forget(existing.id)

            content = self._encode_content(doc_id, node)
            self._client.remember(
                content=content,
                memory_type="procedural",
                heat=0.9,
                namespace=_doc_namespace(self._namespace),
            )

    def get_document(
        self, doc_id: str, raise_error: bool = True
    ) -> Optional[BaseNode]:
        """Retrieve a node by its LlamaIndex document ID.

        Args:
            doc_id: LlamaIndex node/document ID.
            raise_error: Raise ``ValueError`` when the document is not found.

        Returns:
            The stored ``BaseNode``, or ``None`` if not found and
            ``raise_error`` is ``False``.
        """
        mem = self._find_by_doc_id(doc_id)
        if mem is None:
            if raise_error:
                raise ValueError(f"Document '{doc_id}' not found in Sulcus.")
            return None

        sentinel = f"__doc_id__:{doc_id}:"
        raw_json = mem.pointer_summary[len(sentinel):]
        return _decode_node(raw_json)

    def document_exists(self, doc_id: str) -> bool:
        """Check whether a document exists in the store.

        Args:
            doc_id: LlamaIndex node/document ID.
        """
        return self._find_by_doc_id(doc_id) is not None

    def delete_document(
        self, doc_id: str, raise_error: bool = True
    ) -> None:
        """Delete a document from the store.

        Args:
            doc_id: LlamaIndex node/document ID.
            raise_error: Raise ``ValueError`` when document is not found.
        """
        mem = self._find_by_doc_id(doc_id)
        if mem is None:
            if raise_error:
                raise ValueError(f"Document '{doc_id}' not found in Sulcus.")
            return
        self._client.forget(mem.id)

    def get_all_document_hashes(self) -> Dict[str, str]:
        """Return a mapping of ``{doc_hash: doc_id}`` for all stored documents.

        Sulcus does not natively track content hashes; this returns an empty
        dict. Override if hash-based deduplication is required.
        """
        return {}

    def get_all_ref_doc_info(self) -> Optional[Dict[str, Any]]:
        """Return reference document metadata for all stored nodes.

        Returns a flat mapping of ``{doc_id: {"doc_id": doc_id}}``.
        """
        sentinel_prefix = "__doc_id__:"
        memories = self._client.list(
            namespace=_doc_namespace(self._namespace),
            memory_type="procedural",
            page_size=100,
        )
        result: Dict[str, Any] = {}
        for mem in memories:
            if mem.pointer_summary.startswith(sentinel_prefix):
                # Extract doc_id between first and second colon segments.
                rest = mem.pointer_summary[len(sentinel_prefix):]
                doc_id = rest.split(":")[0]
                result[doc_id] = {"doc_id": doc_id, "sulcus_id": mem.id}
        return result

    def set_document_hash(self, doc_hash: str, doc_id: str) -> None:
        """No-op compatibility shim. Sulcus doesn't track content hashes."""

    def get_document_hash(self, doc_id: str) -> Optional[str]:
        """No-op compatibility shim. Returns ``None``."""
        return None

    def docs(self) -> Dict[str, BaseNode]:
        """Return all stored nodes as ``{doc_id: BaseNode}``.

        Note: This fetches up to 100 nodes; paginate manually for large stores.
        """
        sentinel_prefix = "__doc_id__:"
        memories = self._client.list(
            namespace=_doc_namespace(self._namespace),
            memory_type="procedural",
            page_size=100,
        )
        result: Dict[str, BaseNode] = {}
        for mem in memories:
            if mem.pointer_summary.startswith(sentinel_prefix):
                rest = mem.pointer_summary[len(sentinel_prefix):]
                parts = rest.split(":", 1)
                if len(parts) == 2:
                    doc_id, raw_json = parts
                    try:
                        result[doc_id] = _decode_node(raw_json)
                    except Exception:
                        pass  # Skip malformed entries gracefully.
        return result
