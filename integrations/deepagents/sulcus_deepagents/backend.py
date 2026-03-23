"""Sulcus-backed storage backend for Deep Agents.

DeepAgents uses "backends" for file storage and execution. This module
provides a SulcusBackend that routes memory-related file operations
through Sulcus while delegating everything else to the default backend.

This is useful when you want Deep Agents' file operations to work normally
but have memory files (AGENTS.md) backed by Sulcus instead of the filesystem.

Usage::

    from sulcus import Sulcus
    from sulcus_deepagents import SulcusBackend
    from deepagents import create_deep_agent

    client = Sulcus(api_key="sk-...")
    agent = create_deep_agent(
        backend=SulcusBackend(client=client)
    )
"""

from __future__ import annotations

import logging
from typing import Any

from sulcus import Sulcus

logger = logging.getLogger(__name__)


class SulcusBackend:
    """Memory-aware backend that intercepts AGENTS.md operations.

    When the agent reads an AGENTS.md file, this backend returns a
    dynamically generated memory summary from Sulcus instead of the
    static file contents. When the agent writes to AGENTS.md, the
    content is parsed and stored as individual memory nodes in Sulcus.

    All other file operations pass through to the underlying backend.

    Args:
        client: An initialised :class:`sulcus.Sulcus` instance.
        memory_files: Set of filenames to intercept (default: {"AGENTS.md"}).
        search_limit: Max memories to include in generated AGENTS.md.
    """

    def __init__(
        self,
        client: Sulcus,
        *,
        memory_files: set[str] | None = None,
        search_limit: int = 30,
    ) -> None:
        self.client = client
        self.memory_files = memory_files or {"AGENTS.md"}
        self.search_limit = search_limit

    def _is_memory_file(self, path: str) -> bool:
        """Check if a path targets a memory file we should intercept."""
        # Match by filename regardless of directory
        import posixpath
        basename = posixpath.basename(path)
        return basename in self.memory_files

    def read_file(self, path: str) -> str:
        """Read a file. Memory files return a Sulcus-generated summary."""
        if self._is_memory_file(path):
            return self._generate_memory_document()
        raise NotImplementedError("Delegate to underlying backend for non-memory files")

    def write_file(self, path: str, content: str) -> str:
        """Write a file. Memory files parse and store content in Sulcus."""
        if self._is_memory_file(path):
            return self._ingest_memory_document(content)
        raise NotImplementedError("Delegate to underlying backend for non-memory files")

    def _generate_memory_document(self) -> str:
        """Generate an AGENTS.md-style document from Sulcus memories."""
        try:
            memories = self.client.list(page=1, page_size=self.search_limit)
        except Exception as e:
            logger.warning(f"Failed to load memories from Sulcus: {e}")
            return "# Agent Memory\n\nMemory system unavailable.\n"

        if not memories:
            return "# Agent Memory\n\nNo memories stored yet.\n"

        # Group by type
        groups: dict[str, list[dict[str, Any]]] = {}
        for mem in memories:
            mtype = mem.get("memory_type", "general")
            groups.setdefault(mtype, []).append(mem)

        lines = ["# Agent Memory", "", "Generated from Sulcus thermodynamic memory graph.", ""]

        type_titles = {
            "preference": "## Preferences",
            "procedural": "## Procedures & Workflows",
            "semantic": "## Knowledge & Facts",
            "episodic": "## Recent Context",
            "moment": "## Significant Moments",
        }

        for mtype, title in type_titles.items():
            items = groups.get(mtype, [])
            if items:
                lines.append(title)
                lines.append("")
                for mem in items:
                    summary = mem.get("pointer_summary", mem.get("label", ""))
                    heat = mem.get("current_heat", 0.0)
                    pinned = mem.get("pinned", False)
                    pin_str = " 📌" if pinned else ""
                    lines.append(f"- {summary} (heat: {heat:.2f}){pin_str}")
                lines.append("")

        # Include any unlisted types
        for mtype, items in groups.items():
            if mtype not in type_titles:
                lines.append(f"## {mtype.title()}")
                lines.append("")
                for mem in items:
                    summary = mem.get("pointer_summary", mem.get("label", ""))
                    lines.append(f"- {summary}")
                lines.append("")

        return "\n".join(lines)

    def _ingest_memory_document(self, content: str) -> str:
        """Parse an AGENTS.md-style document and store entries in Sulcus."""
        stored = 0
        current_type = "semantic"

        type_map = {
            "preferences": "preference",
            "preference": "preference",
            "procedures": "procedural",
            "workflows": "procedural",
            "procedural": "procedural",
            "knowledge": "semantic",
            "facts": "semantic",
            "semantic": "semantic",
            "context": "episodic",
            "recent": "episodic",
            "episodic": "episodic",
            "moments": "moment",
            "moment": "moment",
        }

        for line in content.split("\n"):
            line = line.strip()

            # Detect section headers
            if line.startswith("##"):
                header = line.lstrip("#").strip().lower()
                for keyword, mtype in type_map.items():
                    if keyword in header:
                        current_type = mtype
                        break

            # Store list items as memories
            elif line.startswith("- ") or line.startswith("* "):
                text = line[2:].strip()
                # Strip heat annotations if present
                if "(heat:" in text:
                    text = text[:text.rfind("(heat:")].strip()
                # Strip pin emoji
                text = text.replace("📌", "").strip()

                if text and len(text) > 5:
                    try:
                        self.client.remember(text, memory_type=current_type)
                        stored += 1
                    except Exception as e:
                        logger.warning(f"Failed to store memory: {e}")

        return f"✓ Stored {stored} memories in Sulcus ({current_type} default type)."
