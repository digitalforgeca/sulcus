---
name: sulcus-jetbrains
description: Persistent thermodynamic memory, System 1 curation, and reactive triggers for RubyMine, JetBrains IDEs, and Junie.
---

# JetBrains Memory Skill

When working in RubyMine, IntelliJ IDEA, PyCharm, WebStorm, RustRover, GoLand, CLion, PhpStorm, or Android Studio:

1. **Proactive Recall**:
   - Honor reactive trigger notifications (`trigger.notify`) surfaced in MCP tool responses.
   - At the start of a task, call `build_context` or `search_memory` with the user's request to load relevant architectural decisions and project rules before scanning files.
2. **RubyMine & Rails Verification**:
   - Prefer targeted verification (`bundle exec rspec spec/path_spec.rb:LINE`, `bin/rails test test/path_test.rb:LINE`, `bundle exec rubocop <changed_file>`) and RubyMine PSI symbol navigation over broad repository text searches.
   - Never write flat `MEMORY.md` files; use `store_memory` (`preference`, `fact`, `semantic`, `procedural`, `episodic`).
3. **Capturing Solutions & Decisions**:
   - Store high-signal architectural decisions (`semantic`), team conventions (`preference`), and verified workflows (`procedural`) via `store_memory`.
