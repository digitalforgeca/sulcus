---
name: sulcus-search
description: Search Sulcus persistent memory. Use when user asks about past work, previous sessions, how something was implemented, what they worked on before, or wants to recall information from earlier sessions.
allowed-tools: mcp__sulcus__search_memory, mcp__sulcus__list_memories, mcp__sulcus__graph_neighbors
---

# Sulcus Memory Search

Search Sulcus for past coding sessions, decisions, patterns, and saved information.

## How to Search

Use the Sulcus MCP tools directly:

### Basic search
Call `mcp__sulcus__search_memory` with:
- `query`: What to search for (semantic search)
- `limit`: Number of results (default 5, max 20)

### Browse all memories
Call `mcp__sulcus__list_memories` to see all stored memories, sorted by heat (importance).

### Graph exploration
Call `mcp__sulcus__graph_neighbors` with a memory ID to find related memories through the knowledge graph.

## Search Tips

- Use natural language queries — Sulcus uses semantic search, not keyword matching
- Search for concepts, not exact phrases: "authentication flow" finds memories about auth even if worded differently
- Hot memories (high heat) are more actively used and likely more relevant
- Memory types help narrow results: episodic (events), procedural (how-tos), fact (stable knowledge), preference (opinions), semantic (concepts)

## Examples

- User asks "what did I work on yesterday":
  → `search_memory` with query "recent work completed tasks"

- User asks "how did we implement auth":
  → `search_memory` with query "authentication implementation architecture"

- User asks "what are my coding preferences":
  → `search_memory` with query "coding preferences conventions style"

- User asks "what decisions were made about the database":
  → `search_memory` with query "database architecture decisions choices"

## Present Results

Show memories with their heat score (0.0–1.0, higher = more important/recent), memory type, and timestamp. Offer to search again with different terms or explore the knowledge graph if results aren't sufficient.
