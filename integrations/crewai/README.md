# Sulcus × CrewAI

Shared reactive, thermodynamic memory for multi-agent CrewAI crews. Every agent in the crew reads and writes to the same Sulcus memory graph, with automatic heat propagation across agent boundaries.

## Install

```bash
pip install sulcus-crewai
```

## Quick Start

```python
from crewai import Agent, Crew, Task
from sulcus import Sulcus
from sulcus_crewai import SulcusSearchTool, SulcusStoreTool

client = Sulcus(api_key="sk-...")

# Tools — give to any agent
search = SulcusSearchTool(client=client)
store = SulcusStoreTool(client=client)

researcher = Agent(
    role="Researcher",
    tools=[search, store],
    goal="Find and store key findings",
)

writer = Agent(
    role="Writer",
    tools=[search],
    goal="Compose reports from existing research",
)

crew = Crew(agents=[researcher, writer], tasks=[...])
crew.kickoff()
```

## Components

### Tools (for agents)

| Tool | Description |
|---|---|
| `SulcusSearchTool` | Search memories by natural language query. Returns results ranked by relevance + heat. |
| `SulcusStoreTool` | Store a new memory with type (episodic, semantic, preference, procedural). |
| `SulcusContextTool` | Build a structured context window from relevant memories within a token budget. |

```python
from sulcus_crewai import SulcusSearchTool, SulcusStoreTool, SulcusContextTool

search = SulcusSearchTool(client=client)
store = SulcusStoreTool(client=client)
context = SulcusContextTool(client=client)

agent = Agent(role="Analyst", tools=[search, store, context])
```

### Storage (crew-level shared state)

```python
from sulcus_crewai import SulcusStorage

storage = SulcusStorage(client=client, namespace="research-crew")

# Store findings
storage.save("market_size", "AI memory market estimated at $2.4B by 2027")

# Retrieve by semantic search
results = storage.load("market size")

# List recent
recent = storage.list_recent(limit=10)

# Filter by type
facts = storage.search_by_type("pricing", memory_type="semantic")

# Clean up
storage.forget(node_id="...")
```

## Memory Types

| Type | Use For | Decay |
|---|---|---|
| `episodic` | Events, conversations, findings | Fast (24h half-life) |
| `semantic` | Facts, data, knowledge | Slow (30d half-life) |
| `preference` | Opinions, settings, style | Slower (90d half-life) |
| `procedural` | Workflows, how-tos, recipes | Slowest (180d half-life) |
| `fact` | Stable knowledge, decisions | Near-permanent |
| `synthesis` | Cross-memory inferences, summaries | Slow |
| `moment` | Significant interactions | Slow (custom) |

## How It Works

1. **Researcher agent** discovers something → calls `sulcus_store` → memory created in Sulcus graph
2. **Writer agent** needs context → calls `sulcus_search` → retrieves the researcher's findings
3. **Next crew run** → memories persist, ranked by heat (recency × frequency × relevance)
4. **Over time** → episodic findings decay; semantic facts stay; preferences are nearly permanent

All agents share one Sulcus tenant. The thermodynamic engine handles prioritization — no manual memory management needed.

## Self-Hosted

```python
client = Sulcus(
    api_key="your-key",
    base_url="http://localhost:4200",  # your Sulcus server
)
```

## Examples

See [`examples/research_crew.py`](examples/research_crew.py) for a complete working example.

## Links

- [Sulcus Documentation](https://sulcus.ca/docs)
- [Sulcus Python SDK](https://github.com/digitalforgeca/sulcus/tree/master/sdks/python)
- [All Integrations](https://github.com/digitalforgeca/sulcus/tree/master/integrations)
- [CrewAI Documentation](https://docs.crewai.com/)
