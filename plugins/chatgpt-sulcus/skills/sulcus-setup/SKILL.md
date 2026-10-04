---
name: sulcus-setup
description: Set up SULCUS for ChatGPT and manage persistent memory access.
---

# SULCUS Setup & Lifecycle Directives

SULCUS is the user's persistent memory and context service, accessed via the Model Context Protocol (MCP) server.

## Configuration & Authentication

SULCUS uses the ChatGPT plugin's native Structured Settings capability for managing the user's API key.

The remote MCP server advertises the OpenAI settings capability:
- Read tool: `settings.read`
- Update tool: `settings.update`

The settings schema contains:
- `api_key`: string (Your SULCUS API key from https://sulcus.ca)

The server persists the API key per authenticated ChatGPT user and uses it to authorize downstream memory operations. Never ask the user to paste their API key into ordinary chat, and never expose, repeat, or log the API key in model-visible output.

## Operational Lifecycle Behavior

Follow these lifecycle behaviors across all conversation turns:

### 1. Initialization & Verification
- Check configuration via `settings.read`.
- If no API key is set, guide the user to the plugin's Settings page to input their key.
- Verify authenticated access by calling `get_user_profile` to retrieve active user directives and account status.

### 2. Proactive Recall
- When answering queries that depend on user preferences, past project decisions, architecture conventions, or environment configurations:
  - Query relevant knowledge nodes using `search_memories(query: "...")`.
  - Check active working memories using `list_hot_memories()`.
- Seamlessly weave recalled knowledge into your response without reciting internal search queries, node IDs, or scores back to the user.

### 3. Durable Knowledge Capture
- When the user establishes durable facts, decisions, rules, preferences, or procedural runbooks, persist them using `store_memory(content: "...", label: "...", memory_type: "...", is_pinned: false)`:
  - `preference`: Coding habits, preferred libraries, formatting style, architectural opinions.
  - `fact`: Infrastructure hosts, ports, database configurations, environment variable names.
  - `procedural`: Deployment runbooks, build commands, debugging sequences.
  - `core_identity`: Mission-critical constraints and non-negotiable rules (set `is_pinned: true`).
- Acknowledge storage concisely without repeating the entire saved content.

### 4. Reconciliation & Updating
- When the user updates a previous decision or changes a preference, search for the existing memory with `search_memories` and call `update_memory(id: "...", ...)` to revise it, preventing stale contradictions.

### 5. Explicit Forgetting
- If the user explicitly asks to remove or forget specific information, find the corresponding node with `search_memories` and delete it using `delete_memory(id: "...")`.

### 6. Workspace & Namespace Isolation
- When working across multiple projects or repositories, inspect namespaces via `list_namespaces` or scope operations by passing `namespace` to memory tools. By default, use the `default` namespace.
