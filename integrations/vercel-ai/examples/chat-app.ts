/**
 * Example: Chat app with Sulcus memory tools + middleware.
 *
 * Demonstrates two integration patterns:
 *
 * 1. **Tools pattern** — AI model can call sulcus tools explicitly
 *    (remember, search, list, forget, update).
 *
 * 2. **Middleware pattern** — Memory injection/storage happens transparently
 *    via `wrapLanguageModel`. The AI doesn't need to call tools explicitly.
 *
 * Run:
 *   SULCUS_API_KEY=sk-... OPENAI_API_KEY=sk-... tsx examples/chat-app.ts
 */

import { generateText, streamText, wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { sulcusTools } from "../src/index.js";
import { sulcusMiddleware } from "../src/middleware.js";

const SULCUS_API_KEY = process.env.SULCUS_API_KEY ?? "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

if (!SULCUS_API_KEY) throw new Error("SULCUS_API_KEY is required");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

// ---------------------------------------------------------------------------
// Pattern 1: Explicit memory tools
// ---------------------------------------------------------------------------

async function chatWithTools() {
  console.log("\n=== Pattern 1: Explicit Memory Tools ===\n");

  const tools = sulcusTools({ apiKey: SULCUS_API_KEY });

  const result = await generateText({
    model: openai("gpt-4o"),
    tools,
    maxSteps: 5, // Allow tool call rounds
    system: `You are a helpful assistant with access to a persistent memory system.
Before answering questions, search your memory for relevant context.
Store important information the user shares.`,
    messages: [
      {
        role: "user",
        content: "My name is Alex and I prefer TypeScript over JavaScript.",
      },
    ],
  });

  console.log("Response:", result.text);
  console.log("Tool calls:", result.toolCalls?.length ?? 0);

  // Follow-up — the AI should remember preferences
  const followUp = await generateText({
    model: openai("gpt-4o"),
    tools,
    maxSteps: 5,
    system: `You are a helpful assistant with access to a persistent memory system.
Before answering questions, search your memory for relevant context.`,
    messages: [
      { role: "user", content: "What language do I prefer for coding?" },
    ],
  });

  console.log("\nFollow-up response:", followUp.text);
}

// ---------------------------------------------------------------------------
// Pattern 2: Transparent middleware (no explicit tool calls needed)
// ---------------------------------------------------------------------------

async function chatWithMiddleware() {
  console.log("\n=== Pattern 2: Transparent Middleware ===\n");

  // Wrap the model — memory injection/storage is automatic
  const model = wrapLanguageModel({
    model: openai("gpt-4o"),
    middleware: sulcusMiddleware({
      apiKey: SULCUS_API_KEY,
      memoryLimit: 5,
      storeResponses: true,
      injectMemories: true,
      memoryHeader: "## What I Remember\n",
    }),
  });

  // Stream a response — relevant memories are auto-injected
  const { textStream } = await streamText({
    model,
    system: "You are a helpful assistant.",
    messages: [
      {
        role: "user",
        content: "Summarize what you know about my preferences.",
      },
    ],
  });

  process.stdout.write("Response: ");
  for await (const chunk of textStream) {
    process.stdout.write(chunk);
  }
  console.log("\n");
}

// ---------------------------------------------------------------------------
// Pattern 3: useChat-style Next.js API route (server component)
// ---------------------------------------------------------------------------

/**
 * Example Next.js App Router API route at app/api/chat/route.ts
 *
 * ```ts
 * import { streamText, wrapLanguageModel } from "ai";
 * import { openai } from "@ai-sdk/openai";
 * import { sulcusMiddleware } from "sulcus-vercel-ai/middleware";
 *
 * export async function POST(req: Request) {
 *   const { messages } = await req.json();
 *
 *   const model = wrapLanguageModel({
 *     model: openai("gpt-4o"),
 *     middleware: sulcusMiddleware({
 *       apiKey: process.env.SULCUS_API_KEY!,
 *       memoryLimit: 8,
 *       namespace: "chat",
 *     }),
 *   });
 *
 *   const result = await streamText({
 *     model,
 *     system: "You are a helpful assistant with persistent memory.",
 *     messages,
 *   });
 *
 *   return result.toDataStreamResponse();
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// Pattern 4: Direct tool usage with memory management
// ---------------------------------------------------------------------------

async function memoryManagementExample() {
  console.log("\n=== Pattern 4: Direct Memory Management ===\n");

  const tools = sulcusTools({ apiKey: SULCUS_API_KEY });

  // Manually call tool execute functions for direct memory operations
  const stored = await tools.remember.execute(
    {
      content: "User prefers concise responses under 3 sentences.",
      memoryType: "preference",
      namespace: "user-prefs",
    },
    // Minimal tool call context for direct invocation
    { toolCallId: "direct-1", messages: [], abortSignal: new AbortController().signal }
  );
  console.log("Stored:", stored);

  const results = await tools.search.execute(
    {
      query: "response format preferences",
      limit: 5,
      namespace: "user-prefs",
    },
    { toolCallId: "direct-2", messages: [], abortSignal: new AbortController().signal }
  );
  console.log("Search results:", results);

  // Update heat on a memory
  if (results.length > 0) {
    const updated = await tools.update.execute(
      { id: results[0].id!, heat: 0.95, isPinned: true },
      { toolCallId: "direct-3", messages: [], abortSignal: new AbortController().signal }
    );
    console.log("Pinned:", updated);
  }
}

// ---------------------------------------------------------------------------
// Run examples
// ---------------------------------------------------------------------------

async function main() {
  try {
    await chatWithTools();
    await chatWithMiddleware();
    await memoryManagementExample();
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
