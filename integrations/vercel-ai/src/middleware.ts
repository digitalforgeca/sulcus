/**
 * sulcusMiddleware — Vercel AI SDK `wrapLanguageModel` middleware for Sulcus Memory.
 *
 * Automatically:
 * 1. Retrieves relevant memories based on the last user message and injects
 *    them into the system prompt (via `transformParams`).
 * 2. Stores assistant responses as episodic memories (via `wrapGenerate` / `wrapStream`).
 *
 * @example
 * ```ts
 * import { sulcusMiddleware } from "sulcus-vercel-ai/middleware";
 * import { wrapLanguageModel } from "ai";
 *
 * const model = wrapLanguageModel({
 *   model: openai("gpt-4o"),
 *   middleware: sulcusMiddleware({ apiKey: process.env.SULCUS_API_KEY! }),
 * });
 * ```
 */

import type {
  LanguageModelV3Middleware,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  LanguageModelV3StreamPart,
  LanguageModelV3,
} from "@ai-sdk/provider";
import { Sulcus, type SulcusConfig, type Memory } from "sulcus";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SulcusMiddlewareOptions extends SulcusConfig {
  /**
   * Number of memories to retrieve and inject.
   * Default: 5
   */
  memoryLimit?: number;

  /**
   * Namespace to search/store memories in.
   * Default: "default"
   */
  namespace?: string;

  /**
   * Whether to store assistant responses as episodic memories.
   * Default: true
   */
  storeResponses?: boolean;

  /**
   * Whether to inject memories into the system prompt.
   * Default: true
   */
  injectMemories?: boolean;

  /**
   * Minimum heat threshold for injected memories (0–1).
   * Memories below this heat are excluded.
   * Default: 0 (all memories)
   */
  minHeat?: number;

  /**
   * Custom function to format memories for injection into the system prompt.
   */
  formatMemory?: (memory: Memory) => string;

  /**
   * Custom system prompt prefix for injected memories block.
   * Default: "## Relevant Memories\n"
   */
  memoryHeader?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultFormatMemory(memory: Memory): string {
  const content = memory.pointer_summary ?? memory.label ?? "";
  const type = memory.memory_type ?? "episodic";
  return `- [${type}] ${content}`;
}

/** Extract the last user message text from a LanguageModelV3 prompt. */
function extractLastUserMessage(
  prompt: LanguageModelV3CallOptions["prompt"]
): string | null {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const msg = prompt[i];
    if (msg.role !== "user") continue;
    const text = msg.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ");
    if (text) return text;
  }
  return null;
}

/** Inject memories into the system message of the prompt array. */
function injectIntoPrompt(
  prompt: LanguageModelV3CallOptions["prompt"],
  block: string
): LanguageModelV3CallOptions["prompt"] {
  const cloned = [...prompt] as LanguageModelV3CallOptions["prompt"];

  // Find existing system message
  const sysIdx = cloned.findIndex((m) => m.role === "system");
  if (sysIdx >= 0) {
    const existing = cloned[sysIdx] as { role: "system"; content: string };
    cloned[sysIdx] = { role: "system", content: block + existing.content };
  } else {
    // Prepend a new system message
    cloned.unshift({ role: "system", content: block });
  }
  return cloned;
}

/** Extract text delta from a stream part — v3 uses `.delta`. */
function extractTextDelta(part: LanguageModelV3StreamPart): string | null {
  if (part.type !== "text-delta") return null;
  return part.delta ?? null;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates a Vercel AI SDK `LanguageModelV3Middleware` that:
 * - Retrieves relevant Sulcus memories before each request (via `transformParams`)
 * - Injects them into the system prompt
 * - Stores assistant text responses as episodic memories (via `wrapGenerate` / `wrapStream`)
 *
 * Use with `wrapLanguageModel` from the `ai` package.
 */
export function sulcusMiddleware(
  options: SulcusMiddlewareOptions
): LanguageModelV3Middleware {
  const client = new Sulcus(options);
  const memoryLimit = options.memoryLimit ?? 5;
  const namespace = options.namespace;
  const storeResponses = options.storeResponses ?? true;
  const injectMemories = options.injectMemories ?? true;
  const minHeat = options.minHeat ?? 0;
  const formatMemory = options.formatMemory ?? defaultFormatMemory;
  const memoryHeader = options.memoryHeader ?? "## Relevant Memories\n";

  return {
    specificationVersion: "v3" as const,

    /**
     * transformParams — inject relevant memories into the system prompt
     * before generate or stream calls.
     */
    async transformParams({
      params,
    }: {
      type: "generate" | "stream";
      params: LanguageModelV3CallOptions;
      model: LanguageModelV3;
    }): Promise<LanguageModelV3CallOptions> {
      if (!injectMemories) return params;

      const userMsg = extractLastUserMessage(params.prompt);
      if (!userMsg) return params;

      let memories: Memory[];
      try {
        memories = await client.search(userMsg, { limit: memoryLimit, namespace });
      } catch {
        return params;
      }

      const relevant = memories.filter(
        (m) => (m.current_heat ?? m.heat ?? 0) >= minHeat
      );
      if (relevant.length === 0) return params;

      const block = memoryHeader + relevant.map(formatMemory).join("\n") + "\n\n";
      const newPrompt = injectIntoPrompt(params.prompt, block);

      return { ...params, prompt: newPrompt };
    },

    /**
     * wrapGenerate — store assistant response after non-streaming calls.
     */
    async wrapGenerate({
      doGenerate,
      params,
    }: {
      doGenerate: () => PromiseLike<LanguageModelV3GenerateResult>;
      doStream: () => PromiseLike<LanguageModelV3StreamResult>;
      params: LanguageModelV3CallOptions;
      model: LanguageModelV3;
    }): Promise<LanguageModelV3GenerateResult> {
      const result = await doGenerate();

      if (storeResponses) {
        const text = result.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("")
          .trim()
          .slice(0, 2000);

        if (text) {
          const userMsg = extractLastUserMessage(params.prompt) ?? "response";
          try {
            void client.remember(
              `[Response to: "${userMsg.slice(0, 100)}"] ${text}`,
              { memoryType: "episodic", namespace, heat: 0.6 }
            );
          } catch {
            // Non-fatal
          }
        }
      }

      return result;
    },

    /**
     * wrapStream — store accumulated assistant response after streaming calls.
     */
    async wrapStream({
      doStream,
      params,
    }: {
      doGenerate: () => PromiseLike<LanguageModelV3GenerateResult>;
      doStream: () => PromiseLike<LanguageModelV3StreamResult>;
      params: LanguageModelV3CallOptions;
      model: LanguageModelV3;
    }): Promise<LanguageModelV3StreamResult> {
      const { stream, ...rest } = await doStream();

      if (!storeResponses) {
        return { stream, ...rest };
      }

      const userMsg = extractLastUserMessage(params.prompt) ?? "response";
      let accumulated = "";

      const transformedStream = new ReadableStream<LanguageModelV3StreamPart>({
        async start(controller) {
          const reader = stream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const delta = extractTextDelta(value);
              if (delta !== null) accumulated += delta;

              controller.enqueue(value);
            }
          } finally {
            reader.releaseLock();
          }

          const text = accumulated.trim().slice(0, 2000);
          if (text) {
            try {
              await client.remember(
                `[Response to: "${userMsg.slice(0, 100)}"] ${text}`,
                { memoryType: "episodic", namespace, heat: 0.6 }
              );
            } catch {
              // Non-fatal
            }
          }

          controller.close();
        },
        cancel() {
          stream.cancel();
        },
      });

      return { stream: transformedStream, ...rest };
    },
  };
}
