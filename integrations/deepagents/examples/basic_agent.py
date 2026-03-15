"""Example: Deep Agent with Sulcus thermodynamic memory.

The agent has persistent memory across sessions. It can store, search,
recall, pin, and forget memories using the Sulcus tools. The middleware
automatically injects relevant context on every turn.

Usage:
    pip install sulcus deepagents sulcus-deepagents
    export SULCUS_API_KEY="sk-..."
    export ANTHROPIC_API_KEY="sk-ant-..."
    python basic_agent.py
"""

import os

from deepagents import create_deep_agent
from sulcus import Sulcus
from sulcus_deepagents import SulcusMemoryMiddleware, SulcusMemoryTools


# ── Sulcus client ────────────────────────────────────────────────

client = Sulcus(
    api_key=os.environ.get("SULCUS_API_KEY", "sk-..."),
    server_url=os.environ.get("SULCUS_SERVER_URL", "https://server.sulcus.dforge.ca"),
)

# ── Memory tools ─────────────────────────────────────────────────

memory_tools = SulcusMemoryTools(client=client)

# ── Create Deep Agent with Sulcus memory ─────────────────────────

agent = create_deep_agent(
    # Middleware: injects relevant memories into every system prompt
    middleware=[
        SulcusMemoryMiddleware(client=client, search_limit=15, token_budget=2000),
    ],
    # Tools: gives the agent explicit memory operations
    tools=memory_tools.tools(),
    system_prompt=(
        "You are a helpful assistant with persistent memory. "
        "You remember everything important across sessions. "
        "Store preferences, facts, and procedures as you learn them."
    ),
)

# ── Run ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    # First run: the agent starts fresh
    result = agent.invoke({
        "messages": [{"role": "user", "content": "I prefer dark mode and use TypeScript."}]
    })
    print("Agent:", result["messages"][-1].content)

    # Second run: the agent remembers
    result = agent.invoke({
        "messages": [{"role": "user", "content": "What do you know about my preferences?"}]
    })
    print("Agent:", result["messages"][-1].content)
