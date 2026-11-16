# Sulcus Vercel AI

Vercel AI SDK tools and middleware for [Sulcus](https://sulcus.ca) — Autonomous Memory & Semantic VMMU for AI Agents.

Provides two integration patterns:

1. **`sulcusTools()`** — Explicit tool definitions the AI model can call to remember, search, list, forget, and update memories.
2. **`sulcusMiddleware()`** — Transparent `LanguageModelV1Middleware` that automatically injects relevant memories into the system prompt and stores assistant responses.

---

## Installation

> **Note:** Sulcus companion packages are published directly to GitHub and consumed via Git URLs. No third-party package registry (npm) is required.

```bash
git clone https://github.com/digitalforgeca/sulcus.git  # integrations/vercel-ai
```

---

## Quick Start

### Memory Tools

The AI model decides when to call memory tools.

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { sulcusTools } from "sulcus-vercel-ai";

const tools = sulcusTools({ apiKey: process.env.SULCUS_API_KEY! });

const result = await generateText({
  model: openai("gpt-4o"),
  tools,
  maxSteps: 5,
  system: `You are a helpful assistant with persistent memory.
Before answering, search your memory for relevant context.
Store important new information the user shares.`,
  messages: [{ role: "user", content: "I prefer TypeScript over JavaScript." }],
});
```

### Transparent Middleware

Memory injection and storage happen automatically — no tool calls needed.

```ts
import { streamText, wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { sulcusMiddleware } from "sulcus-vercel-ai/middleware";

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: sulcusMiddleware({
    apiKey: process.env.SULCUS_API_KEY!,
    memoryLimit: 5,       // inject top 5 relevant memories
    storeResponses: true, // save assistant replies as memories
    namespace: "chat",    // organize memories by app/user
  }),
});

const result = await streamText({
  model,
  system: "You are a helpful assistant.",
  messages,
});
```

### App Router

```ts
// app/api/chat/route.ts
import { streamText, wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { sulcusMiddleware } from "sulcus-vercel-ai/middleware";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const model = wrapLanguageModel({
    model: openai("gpt-4o"),
    middleware: sulcusMiddleware({
      apiKey: process.env.SULCUS_API_KEY!,
      namespace: "chat",
    }),
  });

  const result = await streamText({
    model,
    system: "You are a helpful assistant with persistent memory.",
    messages,
  });

  return result.toDataStreamResponse();
}
```

---

## API Reference

### Tool Helper

`sulcusTools(options)` returns a map of Vercel AI SDK `tool()` definitions.

**Options** (extends `SulcusConfig`):
- `apiKey` — Sulcus API key (required)
- `baseUrl` — Sulcus API URL (default: `https://api.sulcus.ca`)
- `namespace` — Default namespace for all operations

**Tools:**

| Tool | Description |
|------|-------------|
| `remember` | Store a new memory with type and namespace |
| `search` | Search memories by text query |
| `list` | List memories with pagination and filters |
| `forget` | Permanently delete a memory |
| `update` | Update content, type, heat, or pin status |

Each tool has a Zod schema for parameters and an `execute` function.

---

### Middleware Helper

`sulcusMiddleware(options)` returns a `LanguageModelV1Middleware` for use with `wrapLanguageModel`.

**Options** (extends `SulcusConfig`):

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | required | Sulcus API key |
| `baseUrl` | `string` | `https://api.sulcus.ca` | Sulcus API URL |
| `namespace` | `string` | `"default"` | Namespace to search/store |
| `memoryLimit` | `number` | `5` | Max memories to inject |
| `storeResponses` | `boolean` | `true` | Store assistant text as episodic memories |
| `injectMemories` | `boolean` | `true` | Inject retrieved memories into system prompt |
| `minHeat` | `number` | `0` | Min heat threshold for injected memories |
| `formatMemory` | `(m: Memory) => string` | `"- [type] content"` | Custom memory formatter |
| `memoryHeader` | `string` | `"## Relevant Memories\n"` | System prompt section header |

---

## Memory Types

| Type | Use Case |
|------|----------|
| `episodic` | Events, conversations, interactions |
| `semantic` | Facts, knowledge, world information |
| `preference` | User preferences and settings |
| `procedural` | Instructions, how-to knowledge |

---

## Decay Model

Sulcus uses a dynamic decay model:
- **Score (0–1)** — represents recency × utility
- High-scoring memories surface first in search results
- Scores decay over time unless pinned
- Use `minHeat` in middleware to filter out low-relevance memories

---

## User Namespaces

Organize memories by user or session:

```ts
sulcusMiddleware({
  apiKey: process.env.SULCUS_API_KEY!,
  namespace: `user-${userId}`,
});
```

---

## Examples

See [`examples/chat-app.ts`](./examples/chat-app.ts) for complete working examples of all patterns.

```bash
SULCUS_API_KEY=sk-... OPENAI_API_KEY=sk-... tsx examples/chat-app.ts
```

---

## License

MIT
