"""Sulcus × Deep Agents — Thermodynamic memory middleware for LangChain Deep Agents.

Drop-in replacement for DeepAgents' file-based MemoryMiddleware.
Instead of reading/writing flat AGENTS.md files, memories flow through
the Sulcus thermodynamic engine: vector search, heat propagation,
topological diffusion, and automatic decay.

Quick start::

    from sulcus import Sulcus
    from sulcus_deepagents import SulcusMemoryMiddleware, SulcusMemoryTools
    from deepagents import create_deep_agent

    client = Sulcus(api_key="sk-...")

    agent = create_deep_agent(
        middleware=[
            SulcusMemoryMiddleware(client=client),
            SulcusMemoryTools(client=client),
        ]
    )
"""

from sulcus_deepagents.middleware import SulcusMemoryMiddleware
from sulcus_deepagents.tools import SulcusMemoryTools
from sulcus_deepagents.backend import SulcusBackend

__all__ = [
    "SulcusMemoryMiddleware",
    "SulcusMemoryTools",
    "SulcusBackend",
]

__version__ = "0.1.0"
