"""Sulcus — Thermodynamic Memory for AI Agents.

Minimal Python SDK. Zero required dependencies beyond the stdlib.
Optional: httpx for async support.

Usage:
    from sulcus import Sulcus

    client = Sulcus(api_key="sk-...")
    client.remember("User prefers dark mode", memory_type="preference")
    results = client.search("dark mode")
    memories = client.list()
"""

from sulcus.client import Sulcus, AsyncSulcus, SulcusError, Memory

__version__ = "0.1.0"
__all__ = ["Sulcus", "AsyncSulcus", "SulcusError", "Memory", "__version__"]
