---
name: sulcus-save
description: Store important information in Sulcus memory. Use when user says "remember this", "save this", "store this for later", or after making significant decisions, learning new patterns, discovering preferences, or completing important tasks. Also use proactively when witnessing architectural decisions, debugging breakthroughs, or convention establishment.
allowed-tools: mcp__sulcus__record_memory, mcp__sulcus__memory_boost, mcp__sulcus__create_trigger
---

# Sulcus Memory Storage

Store, organize, and manage persistent memories in Sulcus.

## Memory Types

Choose the right memory type for what you're storing:

| Type | When to use | Heat decay | Examples |
|------|-------------|------------|---------|
| `episodic` | Events, sessions, what happened | Fast (24h half-life) | "Fixed the auth bug by updating JWT validation", "Session summary" |
| `procedural` | How-to, processes, workflows | Slow (90d half-life) | "To deploy: run cargo build --release, then docker compose up" |
| `fact` | Stable knowledge, architecture | Slow (60d half-life) | "Database uses PostgreSQL 16 with AGE extension", "API key stored in .env" |
| `preference` | Opinions, coding style, conventions | Very slow (120d half-life) | "User prefers functional React over class components" |
| `semantic` | Concepts, relationships | Medium (30d half-life) | "Sulcus relates to thermodynamic memory management" |

## How to Store

Call `mcp__sulcus__record_memory` with:
- `content`: The memory to store (be detailed! Include reasoning, code snippets, file paths)
- `memory_type`: One of the types above

### What makes a good memory

**Good (detailed, searchable):**
```
Fixed authentication bug in /src/auth/jwt.rs: the token validation was failing because we were using HS256 but the tokens were signed with RS256. Changed verify_signature() to accept both algorithms. Key learning: always check algorithm mismatch first when JWT validation fails silently.
```

**Bad (vague, unsearchable):**
```
Fixed a bug
```

### When to store proactively

- Architectural decisions ("chose X over Y because Z")
- Debugging breakthroughs ("the root cause was X")
- Failed approaches ("tried X, didn't work because Y" — prevents re-learning)
- User preferences ("user prefers X style/convention")
- Environment setup ("need to run X before Y works")
- Conventions established ("files go in /src/components, tests in /tests")

## Boost Important Memories

After storing, use `mcp__sulcus__memory_boost` to increase heat on critical memories that should persist longer.

## Create Triggers

Use `mcp__sulcus__create_trigger` to set up reactive rules:
- Fire when certain memory types are created
- Fire when memories cross heat thresholds
- Fire on pattern matches in stored content

Example: Create a trigger that fires when "deployment" memories are stored, to remind about post-deploy checks.
