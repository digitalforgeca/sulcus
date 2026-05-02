#!/usr/bin/env tsx
/**
 * SULCUS × Vercel AI SDK — Full integration example.
 *
 * Requirements:
 *   npm install ai @ai-sdk/openai zod
 *
 * Usage:
 *   export OPENAI_API_KEY=sk-...
 *   cargo build -p sulcus
 *   npx tsx tools/integrations/vercel_ai_example.ts
 */

import { generateText, tool, type CoreMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as path from "path";
import * as readline from "readline";
import { z } from "zod";
import { fileURLToPath } from "url";

// ── SULCUS sidecar ────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SULCUS_BIN = path.join(__dirname, "../../target/debug/sulcus");

let proc: ChildProcessWithoutNullStreams;
let rl: readline.Interface;
const messageQueue: string[] = [];
let pendingResolve: ((v: string) => void) | null = null;

function startSulcus(): void {
  proc = spawn(SULCUS_BIN, ["serve"], { stdio: ["pipe", "pipe", "inherit"] });
  rl = readline.createInterface({ input: proc.stdout });
  rl.on("line", (line) => {
    if (pendingResolve) {
      pendingResolve(line);
      pendingResolve = null;
    } else {
      messageQueue.push(line);
    }
  });
}

let reqId = 0;

async function mcp(
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  reqId++;
  const req = JSON.stringify({
    jsonrpc: "2.0",
    id: reqId,
    method,
    params: params ?? {},
  });
  proc.stdin.write(req + "\n");
  return new Promise((resolve) => {
    const next = messageQueue.shift();
    if (next) {
      resolve(JSON.parse(next));
    } else {
      pendingResolve = (line: string) => resolve(JSON.parse(line));
    }
  });
}

// ── JSON Schema → Zod conversion (simplified) ────────────────────────────────

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: string[];
  description?: string;
  default?: unknown;
};

function jsonSchemaToZod(schema: JsonSchema): z.ZodTypeAny {
  switch (schema.type) {
    case "integer":
      return z.number().int().optional();
    case "number":
      return z.number().optional();
    case "boolean":
      return z.boolean().optional();
    case "array":
      return z.array(z.string()).optional();
    case "object":
      if (schema.properties) {
        const shape: Record<string, z.ZodTypeAny> = {};
        const required = new Set(schema.required ?? []);
        for (const [key, val] of Object.entries(schema.properties)) {
          const fieldSchema = jsonSchemaToZod(val);
          shape[key] = required.has(key) ? fieldSchema : fieldSchema.optional();
        }
        return z.object(shape).partial();
      }
      return z.record(z.unknown()).optional();
    case "string":
    default:
      if (schema.enum) {
        return z.enum(schema.enum as [string, ...string[]]).optional();
      }
      return z.string().optional();
  }
}

// ── Build SULCUS tools for Vercel AI SDK ─────────────────────────────────────

type McpToolDef = {
  name: string;
  description: string;
  inputSchema?: JsonSchema;
};

function buildTools(
  mcpToolDefs: McpToolDef[],
): Record<string, ReturnType<typeof tool>> {
  const tools: Record<string, ReturnType<typeof tool>> = {};

  for (const t of mcpToolDefs) {
    const schema = t.inputSchema ?? { type: "object", properties: {} };
    const zodSchema =
      schema.properties && Object.keys(schema.properties).length > 0
        ? (jsonSchemaToZod(schema) as z.ZodObject<z.ZodRawShape>)
        : z.object({});

    tools[t.name] = tool({
      description: t.description,
      parameters: zodSchema,
      execute: async (args) => {
        const clean = Object.fromEntries(
          Object.entries(args as Record<string, unknown>).filter(
            ([, v]) => v !== undefined && v !== null,
          ),
        );
        const result = await mcp("tools/call", {
          name: t.name,
          arguments: clean,
        });
        const inner = (result.result ?? {}) as Record<string, unknown>;
        const content = inner.content;
        if (Array.isArray(content) && content.length > 0) {
          return (
            (content[0] as { text?: string }).text ?? JSON.stringify(inner)
          );
        }
        return JSON.stringify(inner);
      },
    });
  }

  return tools;
}

// ── Agent loop ────────────────────────────────────────────────────────────────

async function runAgent(
  userMessage: string,
  model = "gpt-4o",
): Promise<string> {
  const messages: CoreMessage[] = [{ role: "user", content: userMessage }];

  const { text } = await generateText({
    model: openai(model),
    system:
      "You are a helpful assistant with access to SULCUS — a persistent semantic memory system. " +
      "Before answering, call build_context with the user's message to retrieve relevant memories. " +
      "After answering, call add_memory to record important new facts.",
    messages,
    tools: await (async () => {
      const resp = await mcp("tools/list");
      const mcpTools =
        (resp as { result?: { tools?: McpToolDef[] } }).result?.tools ?? [];
      return buildTools(mcpTools);
    })(),
    maxSteps: 10,
    onStepFinish: ({ toolCalls, toolResults }) => {
      for (const tc of toolCalls ?? []) {
        const args = JSON.stringify(
          (tc as { args?: unknown }).args ?? {},
        ).slice(0, 120);
        console.log(`  → ${(tc as { toolName?: string }).toolName}(${args}…)`);
      }
      for (const tr of toolResults ?? []) {
        const result = JSON.stringify(
          (tr as { result?: unknown }).result ?? {},
        ).slice(0, 120);
        console.log(`     ← ${result}`);
      }
    },
  });

  return text;
}

// ── Demo ──────────────────────────────────────────────────────────────────────

async function main() {
  startSulcus();

  // Wait briefly for sidecar to be ready
  await new Promise((r) => setTimeout(r, 500));

  await mcp("initialize");

  console.log("=== Seeding memories ===");
  for (const content of [
    "The frontend is built with Next.js 15 and deployed to Vercel.",
    "We use Tailwind CSS for styling and shadcn/ui for components.",
    "TypeScript strict mode is required. ESLint + Prettier enforce code style.",
    "The design system lives in packages/ui. Never put UI components in apps/.",
  ]) {
    await mcp("tools/call", { name: "add_memory", arguments: { content } });
    process.stdout.write(".");
  }
  console.log("\n");

  console.log("=== Vercel AI SDK Agent ===");
  const answer = await runAgent(
    "What do you know about our frontend stack and development standards?",
  );
  console.log(`\n[answer]\n${answer}`);

  await mcp("tools/call", {
    name: "dispatch_background_task",
    arguments: { task: "full_maintenance" },
  });

  proc.kill();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
