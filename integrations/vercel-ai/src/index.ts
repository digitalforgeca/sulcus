/**
 * sulcus-vercel-ai — Vercel AI SDK tools for Sulcus Memory.
 *
 * @example
 * ```ts
 * import { sulcusTools } from "sulcus-vercel-ai";
 * import { generateText } from "ai";
 *
 * const result = await generateText({
 *   model: openai("gpt-4o"),
 *   tools: sulcusTools({ apiKey: process.env.SULCUS_API_KEY! }),
 *   messages,
 * });
 * ```
 */

import { tool } from "ai";
import { z } from "zod";
import { Sulcus, type SulcusConfig, type Memory } from "sulcus";

// ---------------------------------------------------------------------------
// Re-export types
// ---------------------------------------------------------------------------

export type { SulcusConfig, Memory };

// ---------------------------------------------------------------------------
// Tool options
// ---------------------------------------------------------------------------

export interface SulcusToolsOptions extends SulcusConfig {
  /** Default namespace for all tool operations. */
  namespace?: string;
}

// ---------------------------------------------------------------------------
// sulcusTools()
// ---------------------------------------------------------------------------

/**
 * Returns a map of Vercel AI SDK tools backed by Sulcus.
 *
 * Pass the result directly to `generateText`, `streamText`, or `useChat` tools prop.
 *
 * @example
 * ```ts
 * const tools = sulcusTools({ apiKey: "sk-..." });
 * const result = await generateText({ model, tools, messages });
 * ```
 */
export function sulcusTools(options: SulcusToolsOptions) {
  const client = new Sulcus(options);

  return {
    /**
     * Store a new memory in Sulcus.
     */
    remember: tool({
      description:
        "Store a new memory in Sulcus reactive, thermodynamic memory. Use this to persist important information, user preferences, facts, or episodic events across conversations.",
      inputSchema: z.object({
        content: z.string().describe("The text content to remember."),
        memoryType: z
          .enum(["episodic", "semantic", "preference", "procedural", "fact", "synthesis"])
          .optional()
          .default("episodic")
          .describe(
            "Memory type: episodic (events), semantic (facts), preference (user prefs), procedural (instructions), fact (stable knowledge), synthesis (distilled insights)."
          ),
        namespace: z
          .string()
          .optional()
          .describe("Namespace to organize memories. Defaults to 'default'."),
        heat: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Initial heat 0–1 (importance). Defaults to 0.8."),
      }),
      execute: async ({ content, memoryType, namespace, heat }) => {
        const memory = await client.remember(content, { memoryType, namespace, heat });
        return {
          id: memory.id,
          content: memory.pointer_summary ?? memory.label,
          memoryType: memory.memory_type,
          heat: memory.current_heat ?? memory.heat,
          namespace: memory.namespace,
        };
      },
    }),

    /**
     * Search memories by text query.
     */
    search: tool({
      description:
        "Search Sulcus memory by text query. Returns relevant memories sorted by heat (recency + utility). Use before answering questions to retrieve relevant context.",
      inputSchema: z.object({
        query: z.string().describe("Text query to search for in memories."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(10)
          .describe("Maximum number of results to return."),
        memoryType: z
          .enum(["episodic", "semantic", "preference", "procedural", "fact", "synthesis"])
          .optional()
          .describe("Filter results by memory type."),
        namespace: z.string().optional().describe("Filter results by namespace."),
      }),
      execute: async ({ query, limit, memoryType, namespace }) => {
        const results = await client.search(query, { limit, memoryType, namespace });
        return results.map((m) => ({
          id: m.id,
          content: m.pointer_summary ?? m.label,
          memoryType: m.memory_type,
          heat: m.current_heat ?? m.heat,
          namespace: m.namespace,
          isPinned: m.is_pinned,
        }));
      },
    }),

    /**
     * List memories with pagination.
     */
    list: tool({
      description:
        "List stored memories with optional filtering and pagination. Useful for browsing all memories of a certain type or namespace.",
      inputSchema: z.object({
        page: z.number().int().min(1).optional().default(1).describe("Page number (1-indexed)."),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(25)
          .describe("Number of results per page."),
        memoryType: z
          .enum(["episodic", "semantic", "preference", "procedural", "fact", "synthesis"])
          .optional()
          .describe("Filter by memory type."),
        namespace: z.string().optional().describe("Filter by namespace."),
        pinned: z.boolean().optional().describe("If true, return only pinned memories."),
      }),
      execute: async ({ page, pageSize, memoryType, namespace, pinned }) => {
        const memories = await client.list({ page, pageSize, memoryType, namespace, pinned });
        return memories.map((m) => ({
          id: m.id,
          content: m.pointer_summary ?? m.label,
          memoryType: m.memory_type,
          heat: m.current_heat ?? m.heat,
          namespace: m.namespace,
          isPinned: m.is_pinned,
        }));
      },
    }),

    /**
     * Permanently delete a memory.
     */
    forget: tool({
      description:
        "Permanently delete a memory from Sulcus. Use when information is outdated, incorrect, or no longer relevant.",
      inputSchema: z.object({
        id: z.string().describe("The memory ID to delete."),
      }),
      execute: async ({ id }) => {
        await client.forget(id);
        return { deleted: true, id };
      },
    }),

    /**
     * Update an existing memory.
     */
    update: tool({
      description:
        "Update an existing memory's content, type, namespace, or heat. Use to correct outdated information or re-categorize memories.",
      inputSchema: z.object({
        id: z.string().describe("The memory ID to update."),
        content: z.string().optional().describe("New content for the memory."),
        memoryType: z
          .enum(["episodic", "semantic", "preference", "procedural", "fact", "synthesis"])
          .optional()
          .describe("New memory type."),
        namespace: z.string().optional().describe("New namespace."),
        heat: z.number().min(0).max(1).optional().describe("New heat value 0–1."),
        isPinned: z.boolean().optional().describe("Pin or unpin the memory."),
      }),
      execute: async ({ id, content, memoryType, namespace, heat, isPinned }) => {
        const memory = await client.update(id, {
          label: content,
          memoryType,
          namespace,
          heat,
          isPinned,
        });
        return {
          id: memory.id,
          content: memory.pointer_summary ?? memory.label,
          memoryType: memory.memory_type,
          heat: memory.current_heat ?? memory.heat,
          namespace: memory.namespace,
          isPinned: memory.is_pinned,
        };
      },
    }),
  } as const;
}

export type SulcusTools = ReturnType<typeof sulcusTools>;
