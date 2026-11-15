# Sulcus Memory & RubyMine Workflow Guidelines for Junie

You are connected to **Sulcus**, a thermodynamic semantic memory engine (`sulcus mcp-proxy` MCP + pure-Rust lifecycle hooks). Follow these directives on every task:

## 1. Map First, Territory on Page Fault
- Check `<sulcus-memories>` blocks injected at turn start first.
- If no `<sulcus-memories>` block is present in the current turn (for example inside GUI sessions before hooks fire), call `build_context` or `search_memory` with the user's goal before scanning the repository.
- Scan lightweight memory pointers first. Only call `fetch_memory` when you need the full raw payload of a specific memory node.
- Check linked namespaces (via `list_namespaces` / `search_memory`) when a task references external documents, shared specs, or cross-service contracts.

## 2. Never Write Flat `MEMORY.md` Files
- Don't create or edit `MEMORY.md` or `.claude/memory` files.
- Persist durable knowledge with `store_memory` using the right System 1 archetype:
  - `preference`: coding style, gem choices, testing rules, architectural constraints
  - `fact`: verified environment constants, schema invariants, domain axioms
  - `semantic`: service architecture, module boundaries, domain relationships
  - `procedural`: repeatable runbooks, RSpec/Rake commands, deployment workflows
  - `episodic`: root causes of tricky bugs and milestone completions

## 3. RubyMine & Ruby on Rails Conventions
- Prefer targeted verification over full-suite runs while iterating:
  - RSpec: `bundle exec rspec spec/path/to_spec.rb:LINE`
  - Minitest / Rails: `bin/rails test test/path/to_test.rb:LINE`
  - RuboCop (changed files only): `bundle exec rubocop path/to/file.rb`
- Leverage RubyMine's symbol/usage navigation and `db/schema.rb` (or `db/structure.sql`) before running broad text greps across `app/` and `spec/`.
- When modifying ActiveRecord migrations or associations, check both `db/schema.rb` and model specs, and store non-obvious domain invariants in Sulcus (`semantic` or `fact`).
