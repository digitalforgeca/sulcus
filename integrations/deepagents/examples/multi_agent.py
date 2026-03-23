"""Example: Deep Agent with sub-agents sharing Sulcus memory.

The main agent delegates research to a sub-agent. Both agents share
the same Sulcus tenant, so the sub-agent's findings are immediately
available to the main agent and persist across sessions.

This is where Sulcus fundamentally outperforms file-based memory:
sub-agents in DeepAgents get isolated filesystems, so AGENTS.md
changes in a sub-agent are lost when it terminates. Sulcus memories
persist because they're in the shared graph, not the sandbox.

Usage:
    pip install sulcus deepagents sulcus-deepagents
    export SULCUS_API_KEY="sk-..."
    export ANTHROPIC_API_KEY="sk-ant-..."
    python multi_agent.py
"""

import os

from deepagents import create_deep_agent
from deepagents.middleware.subagents import SubAgent
from sulcus import Sulcus
from sulcus_deepagents import SulcusMemoryMiddleware, SulcusMemoryTools


# ── Shared Sulcus client ─────────────────────────────────────────

client = Sulcus(
    api_key=os.environ.get("SULCUS_API_KEY", "sk-..."),
    server_url=os.environ.get("SULCUS_SERVER_URL", "https://api.sulcus.ca"),
)

memory_tools = SulcusMemoryTools(client=client)

# ── Sub-agent definition ─────────────────────────────────────────

research_subagent: SubAgent = {
    "name": "researcher",
    "description": (
        "A research specialist that finds information and stores "
        "findings in persistent memory for later use."
    ),
    "system_prompt": (
        "You are a research specialist. When you find important information, "
        "ALWAYS store it using sulcus_store before returning results. "
        "Search existing memory first to avoid duplicate work."
    ),
    "tools": memory_tools.tools(),
}

# ── Main agent ───────────────────────────────────────────────────

agent = create_deep_agent(
    middleware=[
        SulcusMemoryMiddleware(client=client),
    ],
    tools=memory_tools.tools(),
    subagents=[research_subagent],
    system_prompt=(
        "You are a project manager with persistent memory. "
        "Delegate research to the 'researcher' sub-agent. "
        "All findings are stored in shared memory — you can access "
        "what the researcher discovers in future sessions."
    ),
)

# ── Run ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    result = agent.invoke({
        "messages": [{
            "role": "user",
            "content": (
                "Research the current state of AI agent memory systems. "
                "Store your key findings, then give me a summary."
            ),
        }]
    })
    print("Agent:", result["messages"][-1].content)
