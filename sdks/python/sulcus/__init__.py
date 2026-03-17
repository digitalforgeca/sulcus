"""Sulcus — Persistent Memory with Reactive Triggers for AI Agents.

Minimal Python SDK. Zero required dependencies beyond the stdlib.
Optional: httpx for async support.

Usage:
    from sulcus import Sulcus

    client = Sulcus(api_key="sk-...")
    client.remember("User prefers dark mode", memory_type="preference")
    results = client.search("dark mode")

    # Triggers — reactive rules on your memory graph
    client.create_trigger("on_recall", "pin", name="Auto-pin recalled memories")
    client.create_trigger("on_store", "notify",
        name="Procedure alert",
        action_config={"message": "New procedure: {label}"},
        filter_memory_type="procedural")
"""

from sulcus.client import Sulcus, AsyncSulcus, SulcusError, Memory

__version__ = "0.3.0"
__all__ = ["Sulcus", "AsyncSulcus", "SulcusError", "Memory", "__version__"]
