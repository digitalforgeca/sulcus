# Sulcus Node.js SDK

**Thermodynamic memory for AI agents.** Zero dependencies.

Sulcus is a memory system where physics decides what to forget. Memories have heat — hot memories are instantly accessible, cold ones fade naturally. CRDT sync keeps agents in lockstep.

## Install

```bash
npm install sulcus
```

## Quick Start

```ts
import { Sulcus } from "sulcus";

const client = new Sulcus({ apiKey: "sk-..." });

// Remember something
await client.remember("User prefers dark mode", { memoryType: "preference" });
await client.remember("Meeting with design team at 3pm", { memoryType: "episodic" });
await client.remember("API rate limit is 1000 req/min", { memoryType: "semantic" });

// Search memories
const results = await client.search("dark mode");
for (const m of results) {
  console.log(`[${m.memory_type}] ${m.pointer_summary} (heat: ${m.current_heat.toFixed(2)})`);
}

// List hot memories
const memories = await client.list({ limit: 10 });

// Update a memory
await client.update(memories[0].id, { label: "Updated preference" });

// Pin important memories (prevents decay)
await client.pin(memories[0].id);

// Forget
await client.forget(memories[0].id);
```

## Self-Hosted

```ts
const client = new Sulcus({
  apiKey: "your-key",
  baseUrl: "http://localhost:4200",
});
```

## Memory Lifecycle Control

```ts
// Store with full control over retention
await client.remember("Deploy procedure for production", {
  memoryType: "procedural",
  decayClass: "permanent",    // "volatile" | "normal" | "stable" | "permanent"
  isPinned: true,             // Prevents decay below minHeat
  minHeat: 0.5,              // Floor — never decays below this
  keyPoints: ["docker build", "az containerapp update", "DEPLOY_TS trick"],
});

// Bulk update multiple memories at once
await client.bulkUpdate(["mem-1", "mem-2", "mem-3"], {
  isPinned: true,
  decayClass: "stable",
});
```

## Memory Types

| Type | Description | Default Decay |
|------|-------------|---------------|
| `episodic` | Events, conversations, experiences | Fast |
| `semantic` | Facts, knowledge, definitions | Slow |
| `preference` | User preferences, settings | Medium |
| `procedural` | How-to knowledge, workflows | Slow |
| `fact` | Stable knowledge, decisions | Near-permanent |

## API

### `new Sulcus({ apiKey, baseUrl?, namespace?, timeoutMs? })`

Create a client. `baseUrl` defaults to Sulcus Cloud.

### `.remember(content, options?) → Promise<Memory>`

Store a memory with full lifecycle control. Options: `memoryType`, `decayClass` (`volatile`/`normal`/`stable`/`permanent`), `isPinned`, `minHeat`, `keyPoints`.

### `.search(query, options?) → Promise<Memory[]>`

Text search. Results sorted by heat (most active first).

### `.list(options?) → Promise<Memory[]>`

List memories with optional filters.

### `.getMemory(id) → Promise<Memory>`

Get a single memory by ID.

### `.update(id, options) → Promise<Memory>`

Update fields on a memory.

### `.forget(id) → Promise<void>`

Permanently delete a memory.

### `.pin(id) / .unpin(id) → Promise<Memory>`

Pin/unpin a memory. Pinned memories don't decay.

### `.whoami() → Promise<OrgInfo>`

Get account/org info.

### `.metrics() → Promise<Metrics>`

Get storage and health metrics.

## Requirements

- Node.js 18+ (uses native `fetch`)
- No runtime dependencies

## License

MIT
