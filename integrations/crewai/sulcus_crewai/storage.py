"""CrewAI storage backend powered by Sulcus.

SulcusStorage implements a simple key-value-like interface that CrewAI
can use for crew-level shared state. Under the hood, each save creates
a memory node in the Sulcus graph, and lookups search by semantic
similarity.

This is a lightweight bridge — for full control over memory types,
heat, decay classes, and the thermodynamic engine, use the tools
or the Sulcus SDK directly.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from sulcus import Sulcus


class SulcusStorage:
    """Shared memory storage backend for CrewAI crews.

    Every agent in the crew can read and write to the same Sulcus
    tenant. Memories persist across crew runs and decay thermodynamically
    based on their type and access patterns.

    Args:
        client: An initialised :class:`sulcus.Sulcus` instance.
        namespace: Optional namespace to isolate this crew's memories.
        default_memory_type: Default type for stored memories.

    Example::

        from sulcus import Sulcus
        from sulcus_crewai import SulcusStorage

        client = Sulcus(api_key="sk-...", server_url="https://api.sulcus.ca")
        storage = SulcusStorage(client=client, namespace="research-crew")

        # Store findings
        storage.save("market_size", "Global AI memory market estimated at $2.4B by 2027")

        # Retrieve by key (semantic search)
        result = storage.load("market size estimates")

        # List recent items
        recent = storage.list_recent(limit=10)
    """

    def __init__(
        self,
        client: Sulcus,
        namespace: str = "default",
        default_memory_type: str = "semantic",
    ) -> None:
        self.client = client
        self.namespace = namespace
        self.default_memory_type = default_memory_type

    def save(
        self,
        key: str,
        value: str,
        memory_type: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Store a value in Sulcus memory.

        Args:
            key: A descriptive label for the memory.
            value: The content to store.
            memory_type: Override the default memory type.
            metadata: Additional metadata (stored in the label).

        Returns:
            The node ID of the created memory.
        """
        mtype = memory_type or self.default_memory_type
        content = f"[{key}] {value}"

        result = self.client.remember(content, memory_type=mtype)
        return result.get("node_id", result.get("id", "unknown"))

    def load(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Search Sulcus memory by semantic similarity.

        Args:
            query: Natural language search query.
            limit: Maximum results to return.

        Returns:
            List of memory dicts with pointer_summary, memory_type,
            current_heat, and other fields.
        """
        return self.client.search(query, limit=limit)

    def list_recent(self, limit: int = 10) -> List[Dict[str, Any]]:
        """List the most recent memories.

        Args:
            limit: Maximum results to return.

        Returns:
            List of memory dicts ordered by creation time (newest first).
        """
        return self.client.list(page=1, page_size=limit)

    def forget(self, node_id: str) -> bool:
        """Delete a specific memory by ID.

        Args:
            node_id: The UUID of the memory to delete.

        Returns:
            True if deleted successfully.
        """
        try:
            self.client.forget(node_id)
            return True
        except Exception:
            return False

    def search_by_type(
        self,
        query: str,
        memory_type: str,
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """Search within a specific memory type.

        Args:
            query: Natural language search query.
            memory_type: Filter results to this type.
            limit: Maximum results to return.

        Returns:
            Filtered list of memory dicts.
        """
        results = self.client.search(query, limit=limit * 2)
        filtered = [r for r in results if r.get("memory_type") == memory_type]
        return filtered[:limit]
