"""Sulcus Python SDK — zero-dependency client for the Sulcus Memory API.

Uses only urllib from the standard library. Install `httpx` for async support.
"""

from __future__ import annotations

import json
import urllib.request
import urllib.error
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class Memory:
    """A single memory node from the Sulcus golden index."""
    id: str
    pointer_summary: str
    memory_type: str = "episodic"
    current_heat: float = 0.0
    base_utility: float = 0.0
    is_pinned: bool = False
    modality: str = "text"
    namespace: str = "default"
    provenance: Optional[Dict[str, Any]] = None
    trained: bool = False
    # v2.2+ fields — absent in older server responses
    recall_count: Optional[int] = None
    last_recalled_at: Optional[str] = None
    interaction_epoch: Optional[int] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Memory":
        # Handle both field name variants across endpoints
        summary = d.get("pointer_summary") or d.get("label", "")
        heat = d.get("current_heat") or d.get("heat") or 0.0
        return cls(
            id=str(d.get("id", "")),
            pointer_summary=summary,
            memory_type=d.get("memory_type", "episodic"),
            current_heat=float(heat),
            base_utility=float(d.get("base_utility", 0)),
            is_pinned=bool(d.get("is_pinned", False)),
            modality=d.get("modality", "text"),
            namespace=d.get("namespace", "default"),
            provenance=d.get("provenance"),
            trained=bool(d.get("trained", False)),
            recall_count=d.get("recall_count"),
            last_recalled_at=d.get("last_recalled_at"),
            interaction_epoch=d.get("interaction_epoch"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class SulcusError(Exception):
    """Raised when the Sulcus API returns an error."""
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(f"SulcusError({status}): {message}")


# ---------------------------------------------------------------------------
# Sync Client (stdlib only — zero dependencies)
# ---------------------------------------------------------------------------

class Sulcus:
    """Synchronous Sulcus client. Uses only urllib (stdlib).

    Args:
        api_key: Sulcus API key (sk-... format or legacy token).
        base_url: Server URL. Defaults to Sulcus Cloud.
        namespace: Default namespace for operations.
        timeout: HTTP timeout in seconds.
    """

    DEFAULT_URL = "https://api.sulcus.ca"

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_URL,
        namespace: str = "default",
        timeout: int = 30,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.namespace = namespace
        self.timeout = timeout

    # -- Core API ----------------------------------------------------------

    def remember(
        self,
        content: str,
        *,
        memory_type: str = "episodic",
        heat: float = 0.8,
        namespace: Optional[str] = None,
        decay_class: Optional[str] = None,
        is_pinned: bool = False,
        min_heat: Optional[float] = None,
        key_points: Optional[List[str]] = None,
        train_on_this: bool = False,
    ) -> Memory:
        """Store a memory. Returns the created Memory node.

        Args:
            content: The text to remember. Supports Markdown formatting —
                use headers, lists, and emphasis to structure key points.
            memory_type: One of 'episodic', 'semantic', 'preference',
                'procedural', 'fact', 'synthesis', 'moment'.
            heat: Initial heat (0.0–1.0). Higher = more accessible.
            namespace: Override the default namespace.
            decay_class: Decay speed override — 'fast', 'normal', 'slow',
                'glacial'. Overrides the default for the memory_type.
            is_pinned: Pin to prevent decay entirely.
            min_heat: Floor heat value (0.0–1.0). Memory never decays below this.
            key_points: Key takeaways as a list of strings. Stored as
                structured metadata for better recall and context building.
            train_on_this: When True, auto-records a training signal for the SIU.
                For remember: records an 'accept' signal (SIVU + SICU).
        """
        body: Dict[str, Any] = {
            "label": content,
            "memory_type": memory_type,
            "heat": heat,
            "namespace": namespace or self.namespace,
        }
        if decay_class is not None:
            body["decay_class"] = decay_class
        if is_pinned:
            body["is_pinned"] = True
        if min_heat is not None:
            body["min_heat"] = min_heat
        if key_points:
            body["key_points"] = key_points
        if train_on_this:
            body["train_on_this"] = True
        data = self._post("/api/v1/agent/nodes", body)
        return Memory.from_dict(data)

    def search(
        self,
        query: str,
        *,
        limit: int = 20,
        memory_type: Optional[str] = None,
        namespace: Optional[str] = None,
    ) -> List[Memory]:
        """Search memories by text. Returns matching nodes sorted by heat.

        Args:
            query: Search text (case-insensitive substring match).
            limit: Max results (1–100).
            memory_type: Filter by type.
            namespace: Filter by namespace.
        """
        body: Dict[str, Any] = {"query": query, "limit": limit}
        if memory_type:
            body["memory_type"] = memory_type
        if namespace:
            body["namespace"] = namespace
        data = self._post("/api/v1/agent/search", body)
        return [Memory.from_dict(m) for m in data]

    def list(
        self,
        *,
        page: int = 1,
        page_size: int = 25,
        memory_type: Optional[str] = None,
        namespace: Optional[str] = None,
        pinned: Optional[bool] = None,
        search: Optional[str] = None,
        sort: str = "current_heat",
        order: str = "desc",
    ) -> List[Memory]:
        """List memories with pagination and filters.

        Args:
            page: Page number (1-indexed).
            page_size: Results per page (1–100).
            memory_type: Filter by type.
            namespace: Filter by namespace.
            pinned: Filter by pinned status.
            search: Text search within pointer_summary.
            sort: Sort field (current_heat, updated_at, memory_type).
            order: Sort order (asc, desc).
        """
        params = f"?page={page}&page_size={page_size}&sort={sort}&order={order}"
        if memory_type:
            params += f"&memory_type={memory_type}"
        if namespace:
            params += f"&namespace={namespace}"
        if pinned is not None:
            params += f"&pinned={'true' if pinned else 'false'}"
        if search:
            params += f"&search={search}"
        data = self._get(f"/api/v1/agent/nodes{params}")
        nodes = data if isinstance(data, list) else (data.get("nodes") or data.get("items") or [])
        return [Memory.from_dict(m) for m in nodes]

    def get(self, memory_id: str) -> Memory:
        """Get a single memory by ID."""
        data = self._get(f"/api/v1/agent/nodes/{memory_id}")
        return Memory.from_dict(data)

    def update(
        self,
        memory_id: str,
        *,
        label: Optional[str] = None,
        memory_type: Optional[str] = None,
        is_pinned: Optional[bool] = None,
        namespace: Optional[str] = None,
        heat: Optional[float] = None,
        train_on_this: bool = False,
    ) -> Memory:
        """Update a memory node. Only provided fields are changed.

        Args:
            memory_id: UUID of the memory to update.
            label: New label/summary text.
            memory_type: New memory type. One of 'episodic', 'semantic',
                'preference', 'procedural', 'fact', 'synthesis', 'moment'.
            is_pinned: Pin or unpin the memory.
            namespace: Move to a different namespace.
            heat: Set heat value (0.0–1.0).
            train_on_this: When True, auto-records a training signal for the SIU.
                For update with type change: records a 'reclassify' signal (SICU).
        """
        body: Dict[str, Any] = {}
        if label is not None:
            body["label"] = label
        if memory_type is not None:
            body["memory_type"] = memory_type
        if is_pinned is not None:
            body["is_pinned"] = is_pinned
        if namespace is not None:
            body["namespace"] = namespace
        if heat is not None:
            body["current_heat"] = heat
        if train_on_this:
            body["train_on_this"] = True
        data = self._patch(f"/api/v1/agent/nodes/{memory_id}", body)
        if data:
            return Memory.from_dict(data)
        # Server may return empty 200; re-fetch the node
        return self.get(memory_id)

    def forget(self, memory_id: str, *, train_on_this: bool = False) -> bool:
        """Delete a memory permanently. Returns True on success.

        Args:
            memory_id: UUID of the memory to delete.
            train_on_this: When True, auto-records a training signal for the SIU.
                For forget: records a 'reject' signal (SIVU).
        """
        path = f"/api/v1/agent/nodes/{memory_id}"
        if train_on_this:
            path += "?train=true"
        self._delete(path)
        return True

    def pin(self, memory_id: str) -> Memory:
        """Pin a memory (prevents heat decay)."""
        return self.update(memory_id, is_pinned=True)

    def unpin(self, memory_id: str) -> Memory:
        """Unpin a memory (resumes heat decay)."""
        return self.update(memory_id, is_pinned=False)

    def bulk_update(
        self,
        ids: List[str],
        *,
        label: Optional[str] = None,
        memory_type: Optional[str] = None,
        is_pinned: Optional[bool] = None,
        namespace: Optional[str] = None,
        heat: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Apply the same update to multiple memories at once.

        Args:
            ids: List of memory UUIDs to update.
            label: New label/summary (applied to all).
            memory_type: New type (applied to all).
            is_pinned: Pin/unpin all.
            namespace: Move all to this namespace.
            heat: Set heat on all (0.0–1.0).

        Returns:
            Dict with 'updated' count and any 'errors'.
        """
        body: Dict[str, Any] = {"ids": ids}
        if label is not None:
            body["label"] = label
        if memory_type is not None:
            body["memory_type"] = memory_type
        if is_pinned is not None:
            body["is_pinned"] = is_pinned
        if namespace is not None:
            body["namespace"] = namespace
        if heat is not None:
            body["current_heat"] = heat
        return self._post("/api/v1/agent/nodes/bulk-patch", body)

    # -- Sync --------------------------------------------------------------

    def sync(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Agent sync — push a CRDT sync payload and receive merged state.

        Used by agent runtimes to reconcile memory state across instances.

        Args:
            payload: Sync payload (agent_id, vector_clock, changes, etc.).

        Returns:
            Merged sync response from the server.
        """
        return self._post("/api/v1/agent/sync", payload)

    # -- Hot Nodes ---------------------------------------------------------

    def hot_nodes(self, limit: int = 20) -> List[Memory]:
        """Return the hottest memories by current_heat (descending).

        Args:
            limit: Maximum number of nodes to return (default 20).
        """
        data = self._get(f"/api/v1/agent/hot_nodes?limit={limit}")
        return [Memory.from_dict(n) for n in data] if isinstance(data, list) else []

    # -- Storage -----------------------------------------------------------

    def storage_status(self) -> Dict[str, Any]:
        """Get storage status (node count, size, namespace breakdown)."""
        return self._get("/api/v1/agent/storage")

    # -- Bulk Delete -------------------------------------------------------

    def bulk_delete(
        self,
        ids: Optional[List[str]] = None,
        memory_type: Optional[str] = None,
        namespace: Optional[str] = None,
    ) -> int:
        """Delete multiple memories at once.

        Args:
            ids: Explicit list of node IDs to delete.
            memory_type: Delete by memory type filter.
            namespace: Delete by namespace filter.

        Returns:
            Number of deleted memories.
        """
        body: Dict[str, Any] = {}
        if ids is not None:
            body["ids"] = ids
        if memory_type is not None:
            body["memory_type"] = memory_type
        if namespace is not None:
            body["namespace"] = namespace
        result = self._post("/api/v1/agent/nodes/bulk", body)
        return result.get("deleted", 0) if isinstance(result, dict) else 0

    # -- Account & Org ----------------------------------------------------

    def whoami(self) -> Dict[str, Any]:
        """Get tenant/org info for the current API key."""
        return self._get("/api/v1/org")

    def update_org(self, **kwargs) -> Dict[str, Any]:
        """Update org settings (name, etc.)."""
        return self._patch("/api/v1/org", kwargs)

    def invite_member(self, email: str, role: str = "member") -> Dict[str, Any]:
        """Invite a member to the org by email."""
        return self._post("/api/v1/org/invite", {"email": email, "role": role})

    def remove_member(self, user_id: str) -> bool:
        """Remove a member from the org."""
        self._request("DELETE", "/api/v1/org/members", {"user_id": user_id})
        return True

    def metrics(self) -> Dict[str, Any]:
        """Get storage and health metrics."""
        return self._get("/api/v1/metrics")

    def dashboard(self) -> Dict[str, Any]:
        """Get dashboard statistics (total nodes, heat distribution, etc.)."""
        return self._get("/api/v1/admin/dashboard")

    def graph(self) -> Dict[str, Any]:
        """Get the memory graph visualization data (nodes + edges)."""
        return self._get("/api/v1/admin/visualize/graph")

    def graph_status(self) -> Dict[str, Any]:
        """Get graph health/status for the current tenant."""
        return self._get("/api/v1/agent/graph/status")

    def graph_neighbors(self, memory_id: str) -> Dict[str, Any]:
        """Get graph neighbors for a memory node.

        Args:
            memory_id: UUID of the memory node.
        """
        return self._get(f"/api/v1/agent/graph/neighbors/{memory_id}")

    def graph_verify(self, memory_id: str) -> Dict[str, Any]:
        """Verify graph integrity for a memory node.

        Args:
            memory_id: UUID of the memory node.
        """
        return self._get(f"/api/v1/agent/graph/verify/{memory_id}")

    # -- Admin: Invites & Usage -------------------------------------------

    def create_invite(self, email: str, role: str = "member") -> Dict[str, Any]:
        """Generate an invite token (admin only).

        Args:
            email: Email to invite.
            role: Role to assign (default: 'member').

        Returns:
            Dict with invite token and expiry.
        """
        return self._post("/api/v1/admin/invite", {"email": email, "role": role})

    def send_invite(self, invite_token: str) -> Dict[str, Any]:
        """Send an invite email for a previously created invite token (admin only).

        Args:
            invite_token: Token returned from create_invite().
        """
        return self._post("/api/v1/admin/invite/send", {"token": invite_token})

    def platform_invite(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Create a platform-level invite (multi-tenant admin only).

        Args:
            payload: Platform invite config (email, plan, metadata, etc.).
        """
        return self._post("/api/v1/admin/invite/platform", payload)

    def usage(self) -> Dict[str, Any]:
        """Get usage statistics for the current billing period (admin only)."""
        return self._get("/api/v1/admin/usage")

    def telemetry_stats(self) -> Dict[str, Any]:
        """Get telemetry statistics (admin only)."""
        return self._get("/api/v1/admin/telemetry")

    def list_waitlist(self, limit: int = 50, cursor: Optional[str] = None) -> Dict[str, Any]:
        """List registered users on the waitlist (admin only).

        Args:
            limit: Maximum entries to return (default 50).
            cursor: Pagination cursor from a previous response.
        """
        path = f"/api/v1/admin/waitlist?limit={limit}"
        if cursor:
            path += f"&cursor={cursor}"
        return self._get(path)

    # -- API Keys ----------------------------------------------------------

    def list_keys(self) -> List[Dict[str, Any]]:
        """List all API keys for the current tenant."""
        data = self._get("/api/v1/keys")
        return data if isinstance(data, list) else data.get("keys", [])

    def create_key(self, name: str = "") -> Dict[str, Any]:
        """Create a new API key. Returns the key (shown only once).

        Args:
            name: Human-readable label for this key.
        """
        return self._post("/api/v1/keys", {"name": name})

    def revoke_key(self, key_id: str) -> bool:
        """Revoke an API key permanently."""
        self._delete(f"/api/v1/keys/{key_id}")
        return True

    # -- Namespace ACL -----------------------------------------------------

    def list_acl(self) -> List[Dict[str, Any]]:
        """List all namespace ACL entries for the current tenant.

        ACL entries control which agent IDs can access which namespaces,
        and with what policy (allow/deny/default).

        Returns:
            List of ACL entries with id, agent_id, namespace, policy.
        """
        data = self._get("/api/v1/namespaces/acl")
        return data if isinstance(data, list) else data.get("items") or data.get("acl") or []

    def upsert_acl(
        self,
        agent_id: str,
        namespace: str,
        policy: str,
    ) -> Dict[str, Any]:
        """Create or update a namespace ACL entry.

        Args:
            agent_id: The agent identifier this rule applies to.
            namespace: The namespace to control access for.
            policy: One of 'allow', 'deny', 'default'.

        Returns:
            The created or updated ACL entry.
        """
        return self._post("/api/v1/namespaces/acl", {
            "agent_id": agent_id,
            "namespace": namespace,
            "policy": policy,
        })

    def delete_acl(self, acl_id: str) -> bool:
        """Delete a namespace ACL entry by ID.

        Args:
            acl_id: The ACL entry UUID to remove.
        """
        self._delete(f"/api/v1/namespaces/acl/{acl_id}")
        return True

    def set_default_namespace(self, namespace: str) -> Dict[str, Any]:
        """Set the default namespace for the current tenant.

        Args:
            namespace: The namespace slug to set as default.
        """
        return self._put("/api/v1/namespaces/default", {"namespace": namespace})

    # -- Thermodynamic Engine ----------------------------------------------

    def get_thermo_config(self) -> Dict[str, Any]:
        """Get the current thermodynamic engine configuration.

        Returns the per-tenant config (or defaults if no custom config set),
        plus the default values for reference.
        """
        return self._get("/api/v1/settings/thermo")

    def set_thermo_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Update the thermodynamic engine configuration.

        Args:
            config: Full ThermoConfig object with decay_profiles, resonance,
                    tick, consolidation, active_index, reinforcement sections.

        Returns:
            The saved config.
        """
        return self._patch("/api/v1/settings/thermo", config)

    def get_thermo(self) -> Dict[str, Any]:
        """Get the thermodynamic engine configuration (v2.2 alias for get_thermo_config)."""
        return self._get("/api/v1/settings/thermo")

    def update_thermo(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Update the thermodynamic engine configuration (v2.2 alias for set_thermo_config).

        Args:
            config: Partial or full ThermoConfig to apply.

        Returns:
            The saved config.
        """
        return self._patch("/api/v1/settings/thermo", config)

    # -- Encryption (Enterprise — CMK via Azure Key Vault) ----------------

    def get_encryption_config(self) -> Dict[str, Any]:
        """Get the current encryption configuration (enterprise only).

        Returns the CMK (Customer-Managed Key) configuration if configured.
        """
        return self._get("/api/v1/settings/encryption")

    def configure_encryption(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Configure customer-managed encryption (enterprise only).

        Args:
            config: Encryption config (key_vault_url, key_name, provider, etc.).

        Returns:
            The saved encryption configuration.
        """
        return self._put("/api/v1/settings/encryption", config)

    def revoke_encryption(self) -> bool:
        """Revoke the current encryption configuration (enterprise only).

        Warning: This disables CMK encryption. Data remains encrypted at rest
        but reverts to platform-managed keys.
        """
        self._delete("/api/v1/settings/encryption")
        return True

    def validate_encryption(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Validate an encryption configuration without applying it (enterprise only).

        Args:
            config: Encryption config to validate.

        Returns:
            Dict with ok status and any error messages.
        """
        return self._post("/api/v1/settings/encryption/validate", config)

    def encryption_audit_log(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get the encryption audit log (enterprise only).

        Returns a history of key rotation, configuration changes, and access events.

        Args:
            limit: Maximum entries to return (default 50).
        """
        data = self._get(f"/api/v1/settings/encryption/audit?limit={limit}")
        return data if isinstance(data, list) else data.get("items") or []

    # -- Memory Status & Consolidation ------------------------------------

    def memory_status(self) -> Dict[str, Any]:
        """Get full memory status: backend info, capabilities, and namespace stats.

        Returns SIU classification status, semantic search availability,
        memory counts, and capability flags.
        """
        return self._get("/api/v1/agent/memory/status")

    def consolidation_candidates(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get consolidation candidates — groups of related memories that could be merged.

        Args:
            limit: Maximum number of candidate groups to return (default 10).
        """
        data = self._get(f"/api/v1/agent/consolidation-candidates?limit={limit}")
        return data if isinstance(data, list) else data.get("candidates") or data.get("groups") or []

    def fold(
        self,
        memory_ids: List[str],
        label: Optional[str] = None,
        memory_type: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Fold (merge/consolidate) two or more memories into one.

        Args:
            memory_ids: UUIDs of memories to fold together.
            label: Optional label for the merged node.
            memory_type: Optional type override for the merged node.
            metadata: Optional metadata for the merged node.
        """
        body: Dict[str, Any] = {"node_ids": memory_ids}
        if label:
            body["label"] = label
        if memory_type:
            body["memory_type"] = memory_type
        if metadata:
            body["metadata"] = metadata
        return self._post("/api/v1/agent/fold", body)

    def backfill_embeddings(
        self,
        namespace: Optional[str] = None,
        limit: Optional[int] = None,
        memory_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Trigger embedding backfill for memories that lack vector embeddings.

        Useful after migration or bulk import. The server processes in the background.

        Args:
            namespace: Optional namespace filter.
            limit: Maximum number of memories to backfill.
            memory_type: Optional memory type filter.
        """
        body: Dict[str, Any] = {}
        if namespace:
            body["namespace"] = namespace
        if limit:
            body["limit"] = limit
        if memory_type:
            body["memory_type"] = memory_type
        return self._post("/api/v1/agent/backfill-embeddings", body)

    def get_siu_model(self) -> Dict[str, Any]:
        """Download the SIU (Semantic Intent Unit) classifier model.

        Returns the JSON model weights used for client-side memory classification.
        Platform-independent, ~56KB, pure inference in JS/TS/Python.
        """
        return self._get("/api/v1/agent/siu-model")

    # -- Extensions --------------------------------------------------------

    def extension_sync(self) -> Dict[str, Any]:
        """Get extension sync state for the current agent/browser session.

        Returns the current memory snapshot and sync token for the
        Sulcus browser extension.
        """
        return self._get("/api/v1/extensions/sync")

    # -- Feedback & Analytics ---------------------------------------------

    def feedback(
        self,
        memory_id: str,
        signal: str,
    ) -> Dict[str, Any]:
        """Send recall quality feedback for a memory node.

        Args:
            memory_id: UUID of the memory node.
            signal: One of 'relevant', 'irrelevant', 'outdated'.
                - relevant: boosts heat + stability (spaced repetition)
                - irrelevant: reduces heat/stability, accelerates decay
                - outdated: nearly kills the memory, sets valid_until=now()

        Returns:
            Dict with heat_before, heat_after, stability_before, stability_after.
        """
        return self._post("/api/v1/feedback", {
            "node_id": memory_id,
            "signal": signal,
        })

    def recall_analytics(self, period: str = "30d") -> Dict[str, Any]:
        """Get recall quality analytics with tuning suggestions.

        Returns per-type stats (relevance ratio, signal counts) and
        suggestions for half-life adjustments based on feedback patterns.
        """
        return self._get("/api/v1/analytics/recall")

    # -- XP / Gamification Profile ----------------------------------------

    def xp_profile(self) -> Dict[str, Any]:
        """Get the XP profile (level, badges, streaks).

        This is the primary path. The legacy ``profile()`` method calls
        ``/gamification/profile`` and is kept as an alias.
        """
        return self._get("/api/v1/xp")

    def profile(self) -> Dict[str, Any]:
        """Get the gamification profile via the legacy route.

        .. deprecated::
            Use ``xp_profile()`` instead.
        """
        return self._get("/api/v1/gamification/profile")

    # -- Activity ----------------------------------------------------------

    def activity(
        self,
        limit: int = 50,
        cursor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get the activity log for your tenant.

        Args:
            limit: Maximum entries to return (default 50).
            cursor: Pagination cursor from a previous response.

        Returns:
            Dict with 'items' list and 'next_cursor'.
        """
        params = f"?limit={limit}"
        if cursor:
            params += f"&cursor={cursor}"
        return self._get(f"/api/v1/activity{params}")

    def record_activity(
        self,
        action: str,
        *,
        target_id: Optional[str] = None,
        target_label: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Record a custom activity event.

        Args:
            action: The action name (e.g. 'export', 'import', 'batch_pin').
            target_id: Optional target entity ID.
            target_label: Optional human-readable target label.
            metadata: Optional extra metadata dict.
        """
        body: Dict[str, Any] = {"action": action}
        if target_id:
            body["target_id"] = target_id
        if target_label:
            body["target_label"] = target_label
        if metadata:
            body["metadata"] = metadata
        return self._post("/api/v1/activity", body)

    # -- Triggers ----------------------------------------------------------

    def list_triggers(self) -> List[Dict[str, Any]]:
        """List all active memory triggers.

        Returns:
            List of trigger objects with id, name, event, action, filters, etc.
        """
        data = self._get("/api/v1/triggers")
        return data.get("items") or data.get("triggers") or []

    def create_trigger(
        self,
        event: str,
        action: str,
        *,
        name: str = "",
        description: str = "",
        action_config: Optional[Dict[str, Any]] = None,
        filter_memory_type: Optional[str] = None,
        filter_namespace: Optional[str] = None,
        filter_label_pattern: Optional[str] = None,
        filter_heat_below: Optional[float] = None,
        filter_heat_above: Optional[float] = None,
        max_fires: Optional[int] = None,
        cooldown_seconds: int = 0,
        train_on_this: bool = False,
    ) -> Dict[str, Any]:
        """Create a reactive trigger on the memory graph.

        Args:
            event: What fires the trigger. One of:
                'on_store', 'on_recall', 'on_decay', 'on_boost',
                'on_relate', 'on_threshold'.
            action: What happens when fired. One of:
                'notify', 'boost', 'pin', 'tag', 'deprecate', 'webhook'.
            name: Human-readable trigger name.
            description: What this trigger does.
            action_config: Action-specific params. Examples:
                notify: {"message": "Alert: {label}"}
                boost:  {"strength": 0.3, "target": "self"}
                tag:    {"label": "important"}
                webhook: {"url": "https://...", "method": "POST"}
            filter_memory_type: Only fire for this memory type.
            filter_namespace: Only fire for this namespace.
            filter_label_pattern: Case-insensitive pattern match on memory content.
            filter_heat_below: Fire when heat drops below this value.
            filter_heat_above: Fire when heat rises above this value.
            max_fires: Maximum times this trigger can fire (None = unlimited).
            cooldown_seconds: Minimum seconds between firings.
            train_on_this: When True, auto-records a training signal for the SIU.
                For create_trigger: records a 'correct' feedback for SITU.

        Returns:
            Dict with trigger_id and confirmation.
        """
        body: Dict[str, Any] = {"event": event, "action": action}
        if name:
            body["name"] = name
        if description:
            body["description"] = description
        if action_config:
            body["action_config"] = action_config
        if filter_memory_type:
            body["filter_memory_type"] = filter_memory_type
        if filter_namespace:
            body["filter_namespace"] = filter_namespace
        if filter_label_pattern:
            body["filter_label_pattern"] = filter_label_pattern
        if filter_heat_below is not None:
            body["filter_heat_below"] = filter_heat_below
        if filter_heat_above is not None:
            body["filter_heat_above"] = filter_heat_above
        if max_fires is not None:
            body["max_fires"] = max_fires
        if cooldown_seconds:
            body["cooldown_seconds"] = cooldown_seconds
        if train_on_this:
            body["train_on_this"] = True
        return self._post("/api/v1/triggers", body)

    def update_trigger(
        self,
        trigger_id: str,
        **kwargs,
    ) -> Dict[str, Any]:
        """Update a trigger. Pass any fields to change as keyword arguments.

        Args:
            trigger_id: UUID of the trigger.
            **kwargs: Fields to update (enabled, name, action_config,
                max_fires, cooldown_seconds, reset_count=True).
        """
        return self._patch(f"/api/v1/triggers/{trigger_id}", kwargs)

    def delete_trigger(self, trigger_id: str) -> bool:
        """Delete a trigger and its history."""
        self._delete(f"/api/v1/triggers/{trigger_id}")
        return True

    def trigger_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get trigger firing history.

        Returns list of events with trigger_id, event, node_id, action, result, fired_at.
        """
        data = self._get(f"/api/v1/triggers/history?limit={limit}")
        return data.get("items") or data.get("history") or []

    # -- SIU v2 — Intelligent Classification -------------------------------

    def siu_label(
        self,
        text: str,
        *,
        quality_only: bool = False,
    ) -> Dict[str, Any]:
        """Classify text using the SIU v2 model.

        Returns the predicted memory type, confidence score, and whether
        the text should be stored as a memory.

        Args:
            text: The text to classify.
            quality_only: If True, only return memory_type classification
                (skip store/discard decision).

        Returns:
            Dict with memory_type, confidence, should_store, reasoning, model.
        """
        body: Dict[str, Any] = {"text": text}
        if quality_only:
            body["quality_only"] = True
        return self._post("/api/v2/siu/label", body)

    def siu_status(self) -> Dict[str, Any]:
        """Get SIU model status (version, training state, accuracy).

        Returns:
            Dict with model, version, status, last_trained, training_samples, accuracy.
        """
        return self._get("/api/v2/siu/status")

    def siu_retrain(self, model: Optional[str] = None) -> Dict[str, Any]:
        """Trigger a SIU model retrain.

        Args:
            model: Optional model identifier to retrain on.

        Returns:
            Dict with retrain job status.
        """
        body: Dict[str, Any] = {}
        if model is not None:
            body["model"] = model
        return self._post("/api/v2/siu/retrain", body)

    # -- SIU v2 — Training Signals ----------------------------------------

    def siu_signal(
        self,
        memory_id: str,
        signal_type: str,
        *,
        predicted_type: Optional[str] = None,
        predicted_store: Optional[bool] = None,
        predicted_conf: Optional[float] = None,
        corrected_type: Optional[str] = None,
        corrected_store: Optional[bool] = None,
        content_snapshot: Optional[str] = None,
        source: str = "sdk",
        namespace: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Record a training signal (correction or confirmation) for SIU.

        Used to build the feedback loop: when the SIU prediction is wrong,
        submit a correction signal so the next retrain improves.

        Args:
            memory_id: UUID of the memory node this signal relates to.
            signal_type: One of 'correction', 'confirmation', 'rejection'.
            predicted_type: What SIU predicted as the memory type.
            predicted_store: What SIU predicted for store/discard.
            predicted_conf: SIU's confidence score for the prediction.
            corrected_type: The correct memory type (for corrections).
            corrected_store: The correct store/discard decision (for corrections).
            content_snapshot: Snapshot of the content at classification time.
            source: Signal source identifier (default 'sdk').
            namespace: Namespace context for the signal.

        Returns:
            Dict with id, memory_id, signal_type, created_at.
        """
        body: Dict[str, Any] = {
            "memory_id": memory_id,
            "signal_type": signal_type,
            "source": source,
        }
        if predicted_type is not None:
            body["predicted_type"] = predicted_type
        if predicted_store is not None:
            body["predicted_store"] = predicted_store
        if predicted_conf is not None:
            body["predicted_conf"] = predicted_conf
        if corrected_type is not None:
            body["corrected_type"] = corrected_type
        if corrected_store is not None:
            body["corrected_store"] = corrected_store
        if content_snapshot is not None:
            body["content_snapshot"] = content_snapshot
        if namespace is not None:
            body["namespace"] = namespace
        return self._post("/api/v2/siu/signal", body)

    def siu_signals(
        self,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """List training signals with pagination.

        Args:
            limit: Maximum entries to return (default 50).
            offset: Offset for pagination (default 0).

        Returns:
            List of signal entries.
        """
        data = self._get(f"/api/v2/siu/signals?limit={limit}&offset={offset}")
        return data if isinstance(data, list) else data.get("items") or data.get("signals") or []

    # -- SILU Config (per-agent intelligence tuning) -----------------------

    def get_silu_config(self, namespace: Optional[str] = None) -> Dict[str, Any]:
        """Get the effective SILU/SIU configuration for a namespace.

        Args:
            namespace: Agent namespace. If None, returns global defaults.

        Returns:
            Dict with effective_config, global_defaults, has_overrides,
            siu_available, silu_available.
        """
        path = f"/api/v1/settings/siu/{namespace}" if namespace else "/api/v1/settings/siu"
        return self._get(path)

    def update_silu_config(self, namespace: str, **config) -> Dict[str, Any]:
        """Update SILU/SIU config for a namespace. Supports BYOK.

        Args:
            namespace: Agent namespace to configure.
            **config: Config fields to set (e.g. silu_enabled=True,
                silu_api_endpoint="https://...", silu_model="gpt-4o-mini").

        Returns:
            Dict with ok=True on success.
        """
        return self._patch(f"/api/v1/settings/siu/{namespace}", config)

    def reset_silu_config(self, namespace: str) -> Dict[str, Any]:
        """Reset a namespace's SILU config to global defaults.

        Args:
            namespace: Agent namespace to reset.

        Returns:
            Dict with ok=True.
        """
        return self._delete(f"/api/v1/settings/siu/{namespace}")

    # -- Trigger Feedback (SITU training) ---------------------------------

    def trigger_feedback(
        self,
        feedback_type: str,
        *,
        trigger_id: Optional[str] = None,
        trigger_log_id: Optional[str] = None,
        event_type: Optional[str] = None,
        memory_id: Optional[str] = None,
        expected_action: Optional[str] = None,
        notes: Optional[str] = None,
        source: str = "sdk",
    ) -> Dict[str, Any]:
        """Submit feedback on a trigger firing for SITU training.

        Use this to tell the system whether a trigger fired correctly,
        was a false positive, or missed an expected action.

        Args:
            feedback_type: One of 'positive', 'negative', 'false_positive',
                'false_negative', 'correction'.
            trigger_id: UUID of the trigger this feedback is about.
            trigger_log_id: UUID of the specific trigger log entry.
            event_type: The event type that fired (on_store, on_recall, etc.).
            memory_id: UUID of the memory node involved.
            expected_action: What action should have happened.
            notes: Free-text notes about the feedback.
            source: Feedback source identifier (default 'sdk').

        Returns:
            Dict with id, feedback_type, created_at.
        """
        body: Dict[str, Any] = {
            "feedback_type": feedback_type,
            "source": source,
        }
        if trigger_id is not None:
            body["trigger_id"] = trigger_id
        if trigger_log_id is not None:
            body["trigger_log_id"] = trigger_log_id
        if event_type is not None:
            body["event_type"] = event_type
        if memory_id is not None:
            body["memory_id"] = memory_id
        if expected_action is not None:
            body["expected_action"] = expected_action
        if notes is not None:
            body["notes"] = notes
        return self._post("/api/v1/triggers/feedback", body)

    def list_trigger_feedback(self, limit: int = 50) -> List[Dict[str, Any]]:
        """List trigger feedback entries.

        Args:
            limit: Maximum entries to return (default 50).

        Returns:
            List of feedback entries.
        """
        data = self._get(f"/api/v1/triggers/feedback?limit={limit}")
        return data if isinstance(data, list) else data.get("items") or data.get("feedback") or []

    # -- Billing -----------------------------------------------------------

    def create_checkout_session(
        self,
        price_id: str,
        success_url: str,
        cancel_url: str,
    ) -> Dict[str, Any]:
        """Create a Stripe checkout session (redirects to payment page).

        Args:
            price_id: Stripe price ID for the plan.
            success_url: URL to redirect to after successful checkout.
            cancel_url: URL to redirect to if checkout is cancelled.

        Returns:
            Dict with 'url' (checkout URL) and 'session_id'.
        """
        return self._post("/api/v1/billing/create-checkout-session", {
            "price_id": price_id,
            "success_url": success_url,
            "cancel_url": cancel_url,
        })

    def create_subscription(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Create a Stripe subscription directly (for server-side billing flows).

        Args:
            payload: Subscription parameters (price_id, payment_method_id, etc.).
        """
        return self._post("/api/v1/billing/create-subscription", payload)

    def create_portal_session(self, return_url: str) -> Dict[str, Any]:
        """Create a Stripe customer portal session (manage subscription/invoices).

        Args:
            return_url: URL to return to after the portal session.

        Returns:
            Dict with 'url' (portal session URL).
        """
        return self._post("/api/v1/billing/create-portal-session", {
            "return_url": return_url,
        })

    def get_products(self) -> List[Dict[str, Any]]:
        """Get available billing products/plans (no auth required).

        Returns the list of available subscription tiers with pricing.
        """
        data = self._get("/api/v1/billing/products")
        return data if isinstance(data, list) else data.get("products") or []

    # -- Auth ----------------------------------------------------------------

    def verify(self) -> Dict[str, Any]:
        """Validate the current API key and return identity, tier, and limits.

        Use this to test key validity before configuring plugins or running sync.
        Returns ``authenticated: True`` with tenant info on success, raises on 401.

        Returns:
            Dict with authenticated, tenant_id, plan_tier, agent_label, limits, features.
        """
        return self._get("/api/v1/auth/verify")

    # -- Public Endpoints (no auth required) ------------------------------

    def status(self) -> Dict[str, Any]:
        """Get the public status of the Sulcus service.

        Suitable for health checks and status pages — does not require auth.

        Returns:
            Dict with 'status' ('ok', 'degraded', or 'down') and optional 'version'.
        """
        return self._get("/api/v1/status")

    def join(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Register a new account (public — no auth required).

        Args:
            payload: Registration details (email, password, org_name, etc.).
        """
        return self._post("/api/v1/admin/join", payload)

    def join_waitlist(
        self,
        email: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Join the Sulcus waitlist (public — no auth required).

        Args:
            email: Email address to register on the waitlist.
            metadata: Optional extra data (source, use_case, etc.).
        """
        body: Dict[str, Any] = {"email": email}
        if metadata:
            body["metadata"] = metadata
        return self._post("/api/v1/waitlist", body)

    def ingest_telemetry(self, payload: Dict[str, Any]) -> None:
        """Submit telemetry data (public — no auth required).

        Used by SDKs and extensions to report usage metrics.

        Args:
            payload: Telemetry payload.
        """
        self._post("/api/v1/telemetry", payload)

    # -- HTTP primitives ---------------------------------------------------

    def _headers(self) -> Dict[str, str]:
        try:
            from sulcus import __version__ as _ver
        except Exception:
            _ver = "1.0.0"
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": f"sulcus-python/{_ver}",
        }

    def _request(self, method: str, path: str, body: Optional[Dict] = None) -> Any:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(url, data=data, headers=self._headers(), method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode()
                if not raw:
                    return {}
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            body_text = e.read().decode() if e.fp else str(e)
            raise SulcusError(e.code, body_text) from e
        except urllib.error.URLError as e:
            raise SulcusError(0, f"Connection failed: {e.reason}") from e

    def _get(self, path: str) -> Any:
        return self._request("GET", path)

    def _post(self, path: str, body: Dict) -> Any:
        return self._request("POST", path, body)

    def _patch(self, path: str, body: Dict) -> Any:
        return self._request("PATCH", path, body)

    def _put(self, path: str, body: Dict) -> Any:
        return self._request("PUT", path, body)

    def _delete(self, path: str) -> Any:
        return self._request("DELETE", path)


# ---------------------------------------------------------------------------
# Async Client (requires httpx — optional dependency)
# ---------------------------------------------------------------------------

class AsyncSulcus:
    """Async Sulcus client. Requires `httpx` (pip install sulcus[async]).

    Same API as Sulcus but all methods are async.
    """

    DEFAULT_URL = "https://api.sulcus.ca"

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_URL,
        namespace: str = "default",
        timeout: int = 30,
    ):
        try:
            import httpx
        except ImportError:
            raise ImportError(
                "AsyncSulcus requires httpx. Install with: pip install sulcus[async]"
            )
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.namespace = namespace
        try:
            from sulcus import __version__ as _ver
        except Exception:
            _ver = "1.0.0"
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": f"sulcus-python/{_ver}",
            },
            timeout=timeout,
        )

    async def remember(
        self,
        content: str,
        *,
        memory_type: str = "episodic",
        heat: float = 0.8,
        namespace: Optional[str] = None,
        decay_class: Optional[str] = None,
        is_pinned: bool = False,
        min_heat: Optional[float] = None,
        key_points: Optional[List[str]] = None,
        train_on_this: bool = False,
    ) -> Memory:
        """Store a memory asynchronously. Returns the created Memory node.

        Args:
            content: The text to remember.
            memory_type: One of 'episodic', 'semantic', 'preference',
                'procedural', 'fact', 'synthesis', 'moment'.
            heat: Initial heat (0.0–1.0).
            namespace: Override the default namespace.
            decay_class: Decay speed override — 'fast', 'normal', 'slow', 'glacial'.
            is_pinned: Pin to prevent decay entirely.
            min_heat: Floor heat value (0.0–1.0).
            key_points: Key takeaways as a list of strings.
            train_on_this: When True, auto-records a training signal for the SIU.
                For remember: records an 'accept' signal (SIVU + SICU).
        """
        body: Dict[str, Any] = {
            "label": content,
            "memory_type": memory_type,
            "heat": heat,
            "namespace": namespace or self.namespace,
        }
        if decay_class is not None:
            body["decay_class"] = decay_class
        if is_pinned:
            body["is_pinned"] = True
        if min_heat is not None:
            body["min_heat"] = min_heat
        if key_points:
            body["key_points"] = key_points
        if train_on_this:
            body["train_on_this"] = True
        resp = await self._client.post("/api/v1/agent/nodes", json=body)
        resp.raise_for_status()
        return Memory.from_dict(resp.json())

    async def search(
        self,
        query: str,
        *,
        limit: int = 20,
        memory_type: Optional[str] = None,
        namespace: Optional[str] = None,
    ) -> List[Memory]:
        body: Dict[str, Any] = {"query": query, "limit": limit}
        if memory_type:
            body["memory_type"] = memory_type
        if namespace:
            body["namespace"] = namespace
        resp = await self._client.post("/api/v1/agent/search", json=body)
        resp.raise_for_status()
        return [Memory.from_dict(m) for m in resp.json()]

    async def list(
        self,
        *,
        page: int = 1,
        page_size: int = 25,
        memory_type: Optional[str] = None,
        namespace: Optional[str] = None,
        pinned: Optional[bool] = None,
        search: Optional[str] = None,
        sort: str = "current_heat",
        order: str = "desc",
    ) -> List[Memory]:
        params: Dict[str, Any] = {
            "page": page, "page_size": page_size,
            "sort": sort, "order": order,
        }
        if memory_type:
            params["memory_type"] = memory_type
        if namespace:
            params["namespace"] = namespace
        if pinned is not None:
            params["pinned"] = str(pinned).lower()
        if search:
            params["search"] = search
        resp = await self._client.get("/api/v1/agent/nodes", params=params)
        resp.raise_for_status()
        data = resp.json()
        nodes = data if isinstance(data, list) else (data.get("nodes") or data.get("items") or [])
        return [Memory.from_dict(m) for m in nodes]

    async def get(self, memory_id: str) -> Memory:
        resp = await self._client.get(f"/api/v1/agent/nodes/{memory_id}")
        resp.raise_for_status()
        return Memory.from_dict(resp.json())

    async def update(
        self,
        memory_id: str,
        *,
        label: Optional[str] = None,
        memory_type: Optional[str] = None,
        is_pinned: Optional[bool] = None,
        namespace: Optional[str] = None,
        heat: Optional[float] = None,
        train_on_this: bool = False,
    ) -> Memory:
        """Update a memory node asynchronously. Only provided fields are changed.

        Args:
            memory_id: UUID of the memory to update.
            label: New label/summary text.
            memory_type: New memory type.
            is_pinned: Pin or unpin the memory.
            namespace: Move to a different namespace.
            heat: Set heat value (0.0–1.0).
            train_on_this: When True, auto-records a training signal for the SIU.
                For update with type change: records a 'reclassify' signal (SICU).
        """
        body: Dict[str, Any] = {}
        if label is not None:
            body["label"] = label
        if memory_type is not None:
            body["memory_type"] = memory_type
        if is_pinned is not None:
            body["is_pinned"] = is_pinned
        if namespace is not None:
            body["namespace"] = namespace
        if heat is not None:
            body["current_heat"] = heat
        if train_on_this:
            body["train_on_this"] = True
        resp = await self._client.patch(f"/api/v1/agent/nodes/{memory_id}", json=body)
        resp.raise_for_status()
        return Memory.from_dict(resp.json())

    async def forget(self, memory_id: str, *, train_on_this: bool = False) -> bool:
        """Delete a memory permanently. Returns True on success.

        Args:
            memory_id: UUID of the memory to delete.
            train_on_this: When True, auto-records a training signal for the SIU.
                For forget: records a 'reject' signal (SIVU).
        """
        path = f"/api/v1/agent/nodes/{memory_id}"
        if train_on_this:
            path += "?train=true"
        resp = await self._client.delete(path)
        resp.raise_for_status()
        return True

    async def pin(self, memory_id: str) -> Memory:
        return await self.update(memory_id, is_pinned=True)

    async def unpin(self, memory_id: str) -> Memory:
        return await self.update(memory_id, is_pinned=False)

    async def bulk_update(
        self,
        ids: List[str],
        *,
        label: Optional[str] = None,
        memory_type: Optional[str] = None,
        is_pinned: Optional[bool] = None,
        namespace: Optional[str] = None,
        heat: Optional[float] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"ids": ids}
        if label is not None:
            body["label"] = label
        if memory_type is not None:
            body["memory_type"] = memory_type
        if is_pinned is not None:
            body["is_pinned"] = is_pinned
        if namespace is not None:
            body["namespace"] = namespace
        if heat is not None:
            body["current_heat"] = heat
        resp = await self._client.post("/api/v1/agent/nodes/bulk-patch", json=body)
        resp.raise_for_status()
        return resp.json()

    async def sync(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Agent sync — push a CRDT sync payload and receive merged state."""
        resp = await self._client.post("/api/v1/agent/sync", json=payload)
        resp.raise_for_status()
        return resp.json()

    async def hot_nodes(self, limit: int = 20) -> List[Memory]:
        resp = await self._client.get(f"/api/v1/agent/hot_nodes?limit={limit}")
        resp.raise_for_status()
        data = resp.json()
        return [Memory.from_dict(n) for n in data] if isinstance(data, list) else []

    async def storage_status(self) -> Dict[str, Any]:
        """Get storage status (node count, size, namespace breakdown)."""
        resp = await self._client.get("/api/v1/agent/storage")
        resp.raise_for_status()
        return resp.json()

    async def bulk_delete(
        self,
        ids: Optional[List[str]] = None,
        memory_type: Optional[str] = None,
        namespace: Optional[str] = None,
    ) -> int:
        body: Dict[str, Any] = {}
        if ids is not None:
            body["ids"] = ids
        if memory_type is not None:
            body["memory_type"] = memory_type
        if namespace is not None:
            body["namespace"] = namespace
        resp = await self._client.post("/api/v1/agent/nodes/bulk", json=body)
        resp.raise_for_status()
        result = resp.json()
        return result.get("deleted", 0) if isinstance(result, dict) else 0

    async def whoami(self) -> Dict[str, Any]:
        resp = await self._client.get("/api/v1/org")
        resp.raise_for_status()
        return resp.json()

    async def update_org(self, **kwargs) -> Dict[str, Any]:
        resp = await self._client.patch("/api/v1/org", json=kwargs)
        resp.raise_for_status()
        return resp.json()

    async def invite_member(self, email: str, role: str = "member") -> Dict[str, Any]:
        resp = await self._client.post("/api/v1/org/invite", json={"email": email, "role": role})
        resp.raise_for_status()
        return resp.json()

    async def remove_member(self, user_id: str) -> bool:
        resp = await self._client.request("DELETE", "/api/v1/org/members", json={"user_id": user_id})
        resp.raise_for_status()
        return True

    async def metrics(self) -> Dict[str, Any]:
        resp = await self._client.get("/api/v1/metrics")
        resp.raise_for_status()
        return resp.json()

    async def dashboard(self) -> Dict[str, Any]:
        resp = await self._client.get("/api/v1/admin/dashboard")
        resp.raise_for_status()
        return resp.json()

    async def graph(self) -> Dict[str, Any]:
        resp = await self._client.get("/api/v1/admin/visualize/graph")
        resp.raise_for_status()
        return resp.json()

    async def graph_status(self) -> Dict[str, Any]:
        """Get graph health/status for the current tenant."""
        resp = await self._client.get("/api/v1/agent/graph/status")
        resp.raise_for_status()
        return resp.json()

    async def graph_neighbors(self, memory_id: str) -> Dict[str, Any]:
        """Get graph neighbors for a memory node."""
        resp = await self._client.get(f"/api/v1/agent/graph/neighbors/{memory_id}")
        resp.raise_for_status()
        return resp.json()

    async def graph_verify(self, memory_id: str) -> Dict[str, Any]:
        """Verify graph integrity for a memory node."""
        resp = await self._client.get(f"/api/v1/agent/graph/verify/{memory_id}")
        resp.raise_for_status()
        return resp.json()

    async def create_invite(self, email: str, role: str = "member") -> Dict[str, Any]:
        """Generate an invite token (admin only)."""
        resp = await self._client.post("/api/v1/admin/invite", json={"email": email, "role": role})
        resp.raise_for_status()
        return resp.json()

    async def send_invite(self, invite_token: str) -> Dict[str, Any]:
        """Send an invite email for a previously created invite token (admin only)."""
        resp = await self._client.post("/api/v1/admin/invite/send", json={"token": invite_token})
        resp.raise_for_status()
        return resp.json()

    async def platform_invite(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Create a platform-level invite (multi-tenant admin only)."""
        resp = await self._client.post("/api/v1/admin/invite/platform", json=payload)
        resp.raise_for_status()
        return resp.json()

    async def usage(self) -> Dict[str, Any]:
        """Get usage statistics for the current billing period (admin only)."""
        resp = await self._client.get("/api/v1/admin/usage")
        resp.raise_for_status()
        return resp.json()

    async def telemetry_stats(self) -> Dict[str, Any]:
        """Get telemetry statistics (admin only)."""
        resp = await self._client.get("/api/v1/admin/telemetry")
        resp.raise_for_status()
        return resp.json()

    async def list_waitlist(self, limit: int = 50, cursor: Optional[str] = None) -> Dict[str, Any]:
        """List registered users on the waitlist (admin only)."""
        path = f"/api/v1/admin/waitlist?limit={limit}"
        if cursor:
            path += f"&cursor={cursor}"
        resp = await self._client.get(path)
        resp.raise_for_status()
        return resp.json()

    async def list_keys(self) -> List[Dict[str, Any]]:
        resp = await self._client.get("/api/v1/keys")
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else data.get("keys", [])

    async def create_key(self, name: str = "") -> Dict[str, Any]:
        resp = await self._client.post("/api/v1/keys", json={"name": name})
        resp.raise_for_status()
        return resp.json()

    async def revoke_key(self, key_id: str) -> bool:
        resp = await self._client.delete(f"/api/v1/keys/{key_id}")
        resp.raise_for_status()
        return True

    async def list_acl(self) -> List[Dict[str, Any]]:
        """List all namespace ACL entries for the current tenant."""
        resp = await self._client.get("/api/v1/namespaces/acl")
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else data.get("items") or data.get("acl") or []

    async def upsert_acl(self, agent_id: str, namespace: str, policy: str) -> Dict[str, Any]:
        """Create or update a namespace ACL entry."""
        resp = await self._client.post("/api/v1/namespaces/acl", json={
            "agent_id": agent_id,
            "namespace": namespace,
            "policy": policy,
        })
        resp.raise_for_status()
        return resp.json()

    async def delete_acl(self, acl_id: str) -> bool:
        """Delete a namespace ACL entry by ID."""
        resp = await self._client.delete(f"/api/v1/namespaces/acl/{acl_id}")
        resp.raise_for_status()
        return True

    async def set_default_namespace(self, namespace: str) -> Dict[str, Any]:
        """Set the default namespace for the current tenant."""
        resp = await self._client.put("/api/v1/namespaces/default", json={"namespace": namespace})
        resp.raise_for_status()
        return resp.json()

    async def get_thermo_config(self) -> Dict[str, Any]:
        resp = await self._client.get("/api/v1/settings/thermo")
        resp.raise_for_status()
        return resp.json()

    async def set_thermo_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        resp = await self._client.patch("/api/v1/settings/thermo", json=config)
        resp.raise_for_status()
        return resp.json()

    async def get_thermo(self) -> Dict[str, Any]:
        """Get the thermodynamic engine configuration (v2.2 alias for get_thermo_config)."""
        resp = await self._client.get("/api/v1/settings/thermo")
        resp.raise_for_status()
        return resp.json()

    async def update_thermo(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Update the thermodynamic engine configuration (v2.2 alias for set_thermo_config)."""
        resp = await self._client.patch("/api/v1/settings/thermo", json=config)
        resp.raise_for_status()
        return resp.json()

    async def get_encryption_config(self) -> Dict[str, Any]:
        """Get the current encryption configuration (enterprise only)."""
        resp = await self._client.get("/api/v1/settings/encryption")
        resp.raise_for_status()
        return resp.json()

    async def configure_encryption(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Configure customer-managed encryption (enterprise only)."""
        resp = await self._client.put("/api/v1/settings/encryption", json=config)
        resp.raise_for_status()
        return resp.json()

    async def revoke_encryption(self) -> bool:
        """Revoke the current encryption configuration (enterprise only)."""
        resp = await self._client.delete("/api/v1/settings/encryption")
        resp.raise_for_status()
        return True

    async def validate_encryption(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Validate an encryption configuration without applying it (enterprise only)."""
        resp = await self._client.post("/api/v1/settings/encryption/validate", json=config)
        resp.raise_for_status()
        return resp.json()

    async def encryption_audit_log(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get the encryption audit log (enterprise only)."""
        resp = await self._client.get(f"/api/v1/settings/encryption/audit?limit={limit}")
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else data.get("items") or []

    # -- Memory Status & Consolidation ------------------------------------

    async def memory_status(self) -> Dict[str, Any]:
        """Get full memory status: backend info, capabilities, and namespace stats."""
        resp = await self._client.get("/api/v1/agent/memory/status")
        resp.raise_for_status()
        return resp.json()

    async def consolidation_candidates(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get consolidation candidates — groups of related memories that could be merged."""
        resp = await self._client.get(f"/api/v1/agent/consolidation-candidates?limit={limit}")
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else data.get("candidates") or data.get("groups") or []

    async def fold(
        self,
        memory_ids: List[str],
        label: Optional[str] = None,
        memory_type: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Fold (merge/consolidate) two or more memories into one."""
        body: Dict[str, Any] = {"node_ids": memory_ids}
        if label:
            body["label"] = label
        if memory_type:
            body["memory_type"] = memory_type
        if metadata:
            body["metadata"] = metadata
        resp = await self._client.post("/api/v1/agent/fold", json=body)
        resp.raise_for_status()
        return resp.json()

    async def backfill_embeddings(
        self,
        namespace: Optional[str] = None,
        limit: Optional[int] = None,
        memory_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Trigger embedding backfill for memories that lack vector embeddings."""
        body: Dict[str, Any] = {}
        if namespace:
            body["namespace"] = namespace
        if limit:
            body["limit"] = limit
        if memory_type:
            body["memory_type"] = memory_type
        resp = await self._client.post("/api/v1/agent/backfill-embeddings", json=body)
        resp.raise_for_status()
        return resp.json()

    async def get_siu_model(self) -> Dict[str, Any]:
        """Download the SIU classifier model (JSON weights for client-side classification)."""
        resp = await self._client.get("/api/v1/agent/siu-model")
        resp.raise_for_status()
        return resp.json()

    # -- Extensions --------------------------------------------------------

    async def extension_sync(self) -> Dict[str, Any]:
        """Get extension sync state for the current agent/browser session."""
        resp = await self._client.get("/api/v1/extensions/sync")
        resp.raise_for_status()
        return resp.json()

    async def feedback(self, memory_id: str, signal: str) -> Dict[str, Any]:
        resp = await self._client.post("/api/v1/feedback", json={
            "node_id": memory_id,
            "signal": signal,
        })
        resp.raise_for_status()
        return resp.json()

    async def recall_analytics(self) -> Dict[str, Any]:
        resp = await self._client.get("/api/v1/analytics/recall")
        resp.raise_for_status()
        return resp.json()

    async def xp_profile(self) -> Dict[str, Any]:
        """Get the XP profile (level, badges, streaks) — primary path."""
        resp = await self._client.get("/api/v1/xp")
        resp.raise_for_status()
        return resp.json()

    async def profile(self) -> Dict[str, Any]:
        """Get the gamification profile via the legacy route.

        .. deprecated::
            Use ``xp_profile()`` instead.
        """
        resp = await self._client.get("/api/v1/gamification/profile")
        resp.raise_for_status()
        return resp.json()

    async def activity(self, limit: int = 50, cursor: Optional[str] = None) -> Dict[str, Any]:
        params = f"?limit={limit}"
        if cursor:
            params += f"&cursor={cursor}"
        resp = await self._client.get(f"/api/v1/activity{params}")
        resp.raise_for_status()
        return resp.json()

    async def record_activity(
        self,
        action: str,
        *,
        target_id: Optional[str] = None,
        target_label: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Record a custom activity event."""
        body: Dict[str, Any] = {"action": action}
        if target_id:
            body["target_id"] = target_id
        if target_label:
            body["target_label"] = target_label
        if metadata:
            body["metadata"] = metadata
        resp = await self._client.post("/api/v1/activity", json=body)
        resp.raise_for_status()
        return resp.json()

    async def list_triggers(self) -> List[Dict[str, Any]]:
        resp = await self._client.get("/api/v1/triggers")
        resp.raise_for_status()
        data = resp.json()
        return data.get("items") or data.get("triggers") or []

    async def create_trigger(
        self,
        event: str,
        action: str,
        *,
        train_on_this: bool = False,
        **kwargs,
    ) -> Dict[str, Any]:
        """Create a reactive trigger on the memory graph.

        Args:
            event: What fires the trigger.
            action: What happens when fired.
            train_on_this: When True, auto-records a training signal for the SIU.
                For create_trigger: records a 'correct' feedback for SITU.
            **kwargs: Additional trigger parameters (name, description,
                action_config, filters, max_fires, cooldown_seconds).
        """
        body = {"event": event, "action": action, **kwargs}
        if train_on_this:
            body["train_on_this"] = True
        resp = await self._client.post("/api/v1/triggers", json=body)
        resp.raise_for_status()
        return resp.json()

    async def update_trigger(self, trigger_id: str, **kwargs) -> Dict[str, Any]:
        resp = await self._client.patch(f"/api/v1/triggers/{trigger_id}", json=kwargs)
        resp.raise_for_status()
        return resp.json()

    async def delete_trigger(self, trigger_id: str) -> bool:
        resp = await self._client.delete(f"/api/v1/triggers/{trigger_id}")
        resp.raise_for_status()
        return True

    async def trigger_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        resp = await self._client.get(f"/api/v1/triggers/history?limit={limit}")
        resp.raise_for_status()
        data = resp.json()
        return data.get("items") or data.get("history") or []

    # -- SIU v2 — Intelligent Classification -------------------------------

    async def siu_label(
        self,
        text: str,
        *,
        quality_only: bool = False,
    ) -> Dict[str, Any]:
        """Classify text using the SIU v2 model."""
        body: Dict[str, Any] = {"text": text}
        if quality_only:
            body["quality_only"] = True
        resp = await self._client.post("/api/v2/siu/label", json=body)
        resp.raise_for_status()
        return resp.json()

    async def siu_status(self) -> Dict[str, Any]:
        """Get SIU model status (version, training state, accuracy)."""
        resp = await self._client.get("/api/v2/siu/status")
        resp.raise_for_status()
        return resp.json()

    async def siu_retrain(self, model: Optional[str] = None) -> Dict[str, Any]:
        """Trigger a SIU model retrain."""
        body: Dict[str, Any] = {}
        if model is not None:
            body["model"] = model
        resp = await self._client.post("/api/v2/siu/retrain", json=body)
        resp.raise_for_status()
        return resp.json()

    # -- SIU v2 — Training Signals ----------------------------------------

    async def siu_signal(
        self,
        memory_id: str,
        signal_type: str,
        *,
        predicted_type: Optional[str] = None,
        predicted_store: Optional[bool] = None,
        predicted_conf: Optional[float] = None,
        corrected_type: Optional[str] = None,
        corrected_store: Optional[bool] = None,
        content_snapshot: Optional[str] = None,
        source: str = "sdk",
        namespace: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Record a training signal (correction or confirmation) for SIU."""
        body: Dict[str, Any] = {
            "memory_id": memory_id,
            "signal_type": signal_type,
            "source": source,
        }
        if predicted_type is not None:
            body["predicted_type"] = predicted_type
        if predicted_store is not None:
            body["predicted_store"] = predicted_store
        if predicted_conf is not None:
            body["predicted_conf"] = predicted_conf
        if corrected_type is not None:
            body["corrected_type"] = corrected_type
        if corrected_store is not None:
            body["corrected_store"] = corrected_store
        if content_snapshot is not None:
            body["content_snapshot"] = content_snapshot
        if namespace is not None:
            body["namespace"] = namespace
        resp = await self._client.post("/api/v2/siu/signal", json=body)
        resp.raise_for_status()
        return resp.json()

    async def siu_signals(
        self,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """List training signals with pagination."""
        resp = await self._client.get(f"/api/v2/siu/signals?limit={limit}&offset={offset}")
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else data.get("items") or data.get("signals") or []

    # -- SILU Config (per-agent intelligence tuning) -----------------------

    async def get_silu_config(self, namespace: Optional[str] = None) -> Dict[str, Any]:
        """Get effective SILU/SIU config for a namespace (async)."""
        path = f"/api/v1/settings/siu/{namespace}" if namespace else "/api/v1/settings/siu"
        return await self._async_get(path)

    async def update_silu_config(self, namespace: str, **config) -> Dict[str, Any]:
        """Update SILU/SIU config for a namespace (async). Supports BYOK."""
        return await self._async_patch(f"/api/v1/settings/siu/{namespace}", config)

    async def reset_silu_config(self, namespace: str) -> Dict[str, Any]:
        """Reset a namespace's SILU config to global defaults (async)."""
        return await self._async_delete(f"/api/v1/settings/siu/{namespace}")

    # -- Trigger Feedback (SITU training) ---------------------------------

    async def trigger_feedback(
        self,
        feedback_type: str,
        *,
        trigger_id: Optional[str] = None,
        trigger_log_id: Optional[str] = None,
        event_type: Optional[str] = None,
        memory_id: Optional[str] = None,
        expected_action: Optional[str] = None,
        notes: Optional[str] = None,
        source: str = "sdk",
    ) -> Dict[str, Any]:
        """Submit feedback on a trigger firing for SITU training."""
        body: Dict[str, Any] = {
            "feedback_type": feedback_type,
            "source": source,
        }
        if trigger_id is not None:
            body["trigger_id"] = trigger_id
        if trigger_log_id is not None:
            body["trigger_log_id"] = trigger_log_id
        if event_type is not None:
            body["event_type"] = event_type
        if memory_id is not None:
            body["memory_id"] = memory_id
        if expected_action is not None:
            body["expected_action"] = expected_action
        if notes is not None:
            body["notes"] = notes
        resp = await self._client.post("/api/v1/triggers/feedback", json=body)
        resp.raise_for_status()
        return resp.json()

    async def list_trigger_feedback(self, limit: int = 50) -> List[Dict[str, Any]]:
        """List trigger feedback entries."""
        resp = await self._client.get(f"/api/v1/triggers/feedback?limit={limit}")
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else data.get("items") or data.get("feedback") or []

    async def create_checkout_session(
        self,
        price_id: str,
        success_url: str,
        cancel_url: str,
    ) -> Dict[str, Any]:
        """Create a Stripe checkout session."""
        resp = await self._client.post("/api/v1/billing/create-checkout-session", json={
            "price_id": price_id,
            "success_url": success_url,
            "cancel_url": cancel_url,
        })
        resp.raise_for_status()
        return resp.json()

    async def create_subscription(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Create a Stripe subscription directly."""
        resp = await self._client.post("/api/v1/billing/create-subscription", json=payload)
        resp.raise_for_status()
        return resp.json()

    async def create_portal_session(self, return_url: str) -> Dict[str, Any]:
        """Create a Stripe customer portal session."""
        resp = await self._client.post("/api/v1/billing/create-portal-session", json={
            "return_url": return_url,
        })
        resp.raise_for_status()
        return resp.json()

    async def get_products(self) -> List[Dict[str, Any]]:
        """Get available billing products/plans (no auth required)."""
        resp = await self._client.get("/api/v1/billing/products")
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else data.get("products") or []

    async def verify(self) -> Dict[str, Any]:
        """Validate the current API key and return identity, tier, and limits."""
        resp = await self._client.get("/api/v1/auth/verify")
        resp.raise_for_status()
        return resp.json()

    async def status(self) -> Dict[str, Any]:
        """Get the public status of the Sulcus service (no auth required)."""
        resp = await self._client.get("/api/v1/status")
        resp.raise_for_status()
        return resp.json()

    async def join(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Register a new account (public — no auth required)."""
        resp = await self._client.post("/api/v1/admin/join", json=payload)
        resp.raise_for_status()
        return resp.json()

    async def join_waitlist(
        self,
        email: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Join the Sulcus waitlist (public — no auth required)."""
        body: Dict[str, Any] = {"email": email}
        if metadata:
            body["metadata"] = metadata
        resp = await self._client.post("/api/v1/waitlist", json=body)
        resp.raise_for_status()
        return resp.json()

    async def ingest_telemetry(self, payload: Dict[str, Any]) -> None:
        """Submit telemetry data (public — no auth required)."""
        resp = await self._client.post("/api/v1/telemetry", json=payload)
        resp.raise_for_status()

    async def close(self):
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()
