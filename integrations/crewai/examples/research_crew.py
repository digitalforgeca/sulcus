"""Example: Research crew with shared Sulcus memory.

Two agents — a Researcher and a Writer — collaborate on market research.
The Researcher stores findings in Sulcus; the Writer retrieves them to
compose the final report. Memories persist across runs.

Usage:
    pip install sulcus crewai sulcus-crewai
    export SULCUS_API_KEY="sk-..."
    export OPENAI_API_KEY="sk-..."   # or whatever LLM you use
    python research_crew.py
"""

import os

from crewai import Agent, Crew, Task
from sulcus import Sulcus
from sulcus_crewai import SulcusSearchTool, SulcusStoreTool, SulcusContextTool


# ── Sulcus client ────────────────────────────────────────────────

client = Sulcus(
    api_key=os.environ.get("SULCUS_API_KEY", "sk-..."),
    server_url=os.environ.get("SULCUS_SERVER_URL", "https://api.sulcus.ca"),
)

# ── Memory tools ─────────────────────────────────────────────────

search_tool = SulcusSearchTool(client=client)
store_tool = SulcusStoreTool(client=client)
context_tool = SulcusContextTool(client=client)

# ── Agents ───────────────────────────────────────────────────────

researcher = Agent(
    role="Senior Market Researcher",
    goal="Find and store key market data about AI agent memory systems",
    backstory=(
        "You are an expert analyst who tracks the AI infrastructure market. "
        "You store every important finding in memory so the team can access it later."
    ),
    tools=[search_tool, store_tool],
    verbose=True,
)

writer = Agent(
    role="Technical Writer",
    goal="Compose a concise market brief from available research",
    backstory=(
        "You write clear, data-driven market briefs. Before writing, you always "
        "check memory for existing research to avoid redundant work."
    ),
    tools=[search_tool, context_tool],
    verbose=True,
)

# ── Tasks ────────────────────────────────────────────────────────

research_task = Task(
    description=(
        "Research the current state of AI agent memory systems. "
        "Find 3-5 key data points about market size, major players, and trends. "
        "Store each finding in memory with the appropriate memory type."
    ),
    agent=researcher,
    expected_output="A list of 3-5 key findings stored in memory.",
)

writing_task = Task(
    description=(
        "Write a 200-word market brief about AI agent memory systems. "
        "First, search memory for existing research. "
        "Then compose a brief that covers market size, key players, and trends."
    ),
    agent=writer,
    expected_output="A 200-word market brief with data citations.",
)

# ── Crew ─────────────────────────────────────────────────────────

crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    verbose=True,
)

if __name__ == "__main__":
    result = crew.kickoff()
    print("\n" + "=" * 60)
    print("CREW OUTPUT:")
    print("=" * 60)
    print(result)
