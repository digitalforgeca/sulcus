---
name: sulcus
description: Persistent thermodynamic memory, System 1 curation, project namespaces, Activity Ledger undo, and RubyMine/Rails workflow integration for JetBrains Junie.
---

# Junie Memory Skill

Use Sulcus to maintain zero-amnesia context across sessions and branches:

1. **Recall Before Exploration**:
   - Review `<sulcus-memories>` tags if present.
   - When entering an unfamiliar module or when GUI hooks haven't injected context yet, call `build_context` or `search_memory` with your task summary.
   - If the user mentions an external dataset or specific project namespace, pass that namespace filter or inspect `list_namespaces` so scoped memories are included.

2. **High-Signal Memory Storage (`store_memory`)**:
   - Store concise, atomic insights rather than raw terminal logs:
     - `preference`: team conventions (e.g. RSpec request specs vs controller specs, service object patterns)
     - `fact`: verified schema constraints, API versions, queue names
     - `semantic`: how domain subsystems interact
     - `procedural`: non-obvious setup, Rake tasks, debugging steps
   - Never write flat `MEMORY.md` files.

3. **Surgical Undo**:
   - File mutations are snapshotted into the Sulcus Activity Ledger (`PreToolUse` + `PostToolUse`).
