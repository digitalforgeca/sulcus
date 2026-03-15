# Sulcus × CrewAI Integration

> 🚧 **Coming Soon** — This integration is under development.

Shared thermodynamic memory for multi-agent CrewAI crews. Every agent in the crew reads and writes to the same Sulcus memory graph, with automatic heat propagation across agent boundaries.

## Planned Features

- **SulcusTool** — CrewAI-native tool wrapper for `search_memory`, `record_memory`, `build_context`
- **Shared memory graph** — All agents in a crew share one Sulcus tenant
- **Per-agent namespaces** — Optional isolation via Sulcus namespaces
- **Automatic context injection** — Pre-task memory retrieval based on task description
- **Cross-agent heat propagation** — When one agent recalls a memory, it heats up for all agents

## Usage (Preview)

```python
from crewai import Agent, Crew, Task
from sulcus_crewai import SulcusTool, SulcusMemory

# Shared memory backend
memory = SulcusMemory(api_key="sk-...", server_url="https://server.sulcus.dforge.ca")

# Create tools
search_tool = SulcusTool(memory, tool_type="search")
store_tool = SulcusTool(memory, tool_type="store")

# Agents share the same memory
researcher = Agent(
    role="Researcher",
    tools=[search_tool, store_tool],
    memory=memory,
)

writer = Agent(
    role="Writer",
    tools=[search_tool],
    memory=memory,
)

crew = Crew(agents=[researcher, writer], tasks=[...])
crew.kickoff()
```

## Installation (when available)

```bash
pip install sulcus-crewai
```

## Links

- [Sulcus Documentation](https://sulcus.dforge.ca/docs)
- [Sulcus Python SDK](../../sdks/python/)
- [CrewAI Documentation](https://docs.crewai.com/)
