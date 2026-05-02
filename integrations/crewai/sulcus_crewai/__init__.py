"""Sulcus × CrewAI — Shared reactive, thermodynamic memory for multi-agent crews.

Provides CrewAI-native tools and a storage backend so every agent in a crew
reads and writes to the same Sulcus memory graph.

Quick start::

    from sulcus import Sulcus
    from sulcus_crewai import SulcusSearchTool, SulcusStoreTool, SulcusStorage

    client = Sulcus(api_key="sk-...")

    # Use as tools on any agent
    search = SulcusSearchTool(client=client)
    store = SulcusStoreTool(client=client)

    # Or use as a CrewAI storage backend
    storage = SulcusStorage(client=client)
"""

from sulcus_crewai.tools import SulcusSearchTool, SulcusStoreTool, SulcusContextTool
from sulcus_crewai.storage import SulcusStorage

__all__ = [
    "SulcusSearchTool",
    "SulcusStoreTool",
    "SulcusContextTool",
    "SulcusStorage",
]

__version__ = "0.1.0"
