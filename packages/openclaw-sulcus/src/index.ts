import { spawn, ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { Type } from "@sinclair/typebox";

// ─── STATIC AWARENESS ───────────────────────────────────────────────────────
// Injected via before_prompt_build on EVERY turn, unconditionally.
// This is the absolute minimum the LLM needs to know Sulcus exists.
// It fires even if build_context crashes, times out, or returns empty.
const STATIC_AWARENESS = `## Persistent Memory (Sulcus)
You have Sulcus — a persistent, thermodynamic memory system with reactive triggers.
Memories survive across sessions. They have heat (0.0–1.0) that decays over time.

**Your memory tools:**
- \`memory_store\` — Save important information (preferences, facts, procedures, decisions, lessons)
  Parameters: content, memory_type (episodic|semantic|preference|procedural|fact), decay_class (volatile|normal|stable|permanent), is_pinned, min_heat, key_points
- \`memory_recall\` — Search memories semantically. Use before answering about past work, decisions, or people.
  Parameters: query, limit

**When to store:** User states a preference, important decision made, correction given, lesson learned, anything worth surviving this session.
**When to search:** Questions about prior work/decisions, context seems incomplete, user references past conversations.

**Memory types:** episodic (events, fast decay) · semantic (knowledge, slow) · preference (opinions, slower) · procedural (how-tos, slowest) · fact (data, slow)
**Decay classes:** volatile (hours) · normal (days) · stable (weeks) · permanent (never)
**Pinning:** is_pinned=true prevents decay. Use for critical knowledge.
**Triggers:** Reactive rules on memory events. Active triggers and recent fires appear in your context below.`;

// Fallback context when build_context fails — includes the cheatsheet
// but warns that dynamic context is unavailable.
const FALLBACK_AWARENESS = `<sulcus_context token_budget="500">
  <cheatsheet>
    You have Sulcus — persistent memory with reactive triggers.
    STORE:    memory_store (content, memory_type, decay_class, is_pinned, key_points)
    FIND:     memory_recall (query, limit)
    MANAGE:   memory_boost / memory_deprecate / memory_relate / memory_reclassify
    PIN:      Set is_pinned=true to make a memory permanent (immune to decay).
    TRIGGERS: create_trigger to set reactive rules on your memory graph
    TYPES:    episodic (fast fade), semantic (slow), preference, procedural (slowest), fact
    ⚠️ Context build failed this turn — use memory_recall to search manually.
    Below is your active context. Search for deeper recall. Unlimited storage.
  </cheatsheet>
</sulcus_context>`;

// Simple MCP Client for sulcus-local
class SulcusClient {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<string | number, (res: any) => void>();
  private configPath: string | undefined;

  constructor(private binaryPath: string, configPath?: string) {
    this.configPath = configPath;
  }

  async start(configPath?: string) {
    const cfgPath = configPath || this.configPath;
    const args = cfgPath ? ["--config", cfgPath, "stdio"] : ["stdio"];
    this.child = spawn(this.binaryPath, args, {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, RUST_LOG: "info" }
    });

    this.child.on("error", (err) => {
      // Reject all pending calls if the process dies
      for (const [id, resolve] of this.pending) {
        resolve({ error: { code: -1, message: `Sulcus process error: ${err.message}` } });
      }
      this.pending.clear();
      this.child = null;
    });

    this.child.on("exit", (code) => {
      for (const [id, resolve] of this.pending) {
        resolve({ error: { code: -1, message: `Sulcus process exited with code ${code}` } });
      }
      this.pending.clear();
      this.child = null;
    });

    const rl = createInterface({ input: this.child.stdout! });
    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.id && this.pending.has(msg.id)) {
          const resolve = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          resolve(msg);
        }
      } catch (e) {}
    });
  }

  async call(method: string, params: any = {}): Promise<any> {
    if (!this.child) await this.start();
    const id = this.nextId++;
    const request = { jsonrpc: "2.0", id, method: "tools/call", params: { name: method, arguments: params } };
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Sulcus timeout: ${method}`)), 30000);
      this.pending.set(id, (res) => {
        clearTimeout(timeout);
        if (res.error) reject(new Error(res.error.message));
        else {
            // MCP result format
            try {
                const content = JSON.parse(res.result.content[0].text);
                resolve(content);
            } catch(e) {
                resolve(res.result);
            }
        }
      });
      this.child!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  stop() {
    if (this.child) this.child.kill();
  }
}

const sulcusPlugin = {
  id: "memory-sulcus",
  name: "Sulcus vMMU",
  description: "Sulcus-backed vMMU memory for OpenClaw — thermodynamic decay, reactive triggers, local-first with cloud sync",
  kind: "memory" as const,

  register(api: any) {
    const binaryPath = api.config?.binaryPath || "/Users/dv00003-00/dev/sulcus/target/release/sulcus-local";
    const iniPath = api.config?.iniPath || resolve(process.env.HOME || "~", ".config/sulcus/sulcus.ini");
    const namespace = api.config?.namespace || "default";
    const client = new SulcusClient(binaryPath, iniPath);

    api.logger.info(`memory-sulcus: registered (binary: ${binaryPath}, namespace: ${namespace})`);

    // ── Core memory tools ──

    api.registerTool({
      name: "memory_recall",
      label: "Memory Recall",
      description: "Search Sulcus memory for relevant context",
      parameters: Type.Object({
        query: Type.String({ description: "Search query string." }),
        limit: Type.Optional(Type.Number({ default: 5, description: "Maximum number of results to return (1-10)." }))
      }),
      async execute(_id: string, params: any) {
        const res = await client.call("search_memory", { query: params.query, limit: params.limit });
        return {
          content: [{ type: "text", text: JSON.stringify(res.results, null, 2) }],
          details: res
        };
      }
    }, { name: "memory_recall" });

    api.registerTool({
      name: "memory_store",
      label: "Memory Store",
      description: "Record information in Sulcus memory. Supports Markdown formatting. You control the memory type, decay rate, importance, and key details at creation time.",
      parameters: Type.Object({
        content: Type.String({ description: "Memory content. Supports Markdown formatting for structured content." }),
        fold_name: Type.Optional(Type.String({ default: "default" })),
        memory_type: Type.Optional(Type.Union([
          Type.Literal("episodic"),
          Type.Literal("semantic"),
          Type.Literal("preference"),
          Type.Literal("procedural"),
          Type.Literal("fact")
        ], { description: "Memory type. preference=user preferences, procedural=how-to/processes, fact=stable knowledge, semantic=concepts/relationships, episodic=events/experiences. Default: episodic" })),
        decay_class: Type.Optional(Type.Union([
          Type.Literal("volatile"),
          Type.Literal("normal"),
          Type.Literal("stable"),
          Type.Literal("permanent")
        ], { description: "Decay rate. volatile=fast decay, normal=default, stable=slow decay, permanent=never decays" })),
        is_pinned: Type.Optional(Type.Boolean({ description: "Pin memory to prevent decay below min_heat" })),
        min_heat: Type.Optional(Type.Number({ description: "Minimum heat floor (0.0-1.0). Pinned memories won't decay below this." })),
        key_points: Type.Optional(Type.Array(Type.String(), { description: "Key points to index for search. Extracted highlights." }))
      }),
      async execute(_id: string, params: any) {
        const res = await client.call("record_memory", { ...params, namespace });
        // Check for storage limit error
        if (res?.error === "storage_limit_reached") {
          return {
            content: [{ type: "text", text: `⚠️ Storage limit reached: ${res.message}` }],
            details: res
          };
        }
        return {
          content: [{ type: "text", text: `Stored memory ${res.node_id}` }],
          details: res
        };
      }
    }, { name: "memory_store" });

    // ── Context injection: before every agent turn ──

    // ── STATIC AWARENESS: fires on EVERY prompt build, unconditionally ──
    // This guarantees the LLM always knows Sulcus exists, even on first
    // turn of a new session, even if build_context fails or times out.
    api.on("before_prompt_build", async (_event: any) => {
      return { appendSystemContext: STATIC_AWARENESS };
    });

    // ── DYNAMIC CONTEXT: fires before each agent turn with live data ──
    api.on("before_agent_start", async (event: any) => {
      api.logger.info(`memory-sulcus: before_agent_start hook triggered for agent ${event.agentId}`);
      if (!event.prompt) return;
      try {
        api.logger.debug(`memory-sulcus: building context for prompt: ${event.prompt.substring(0, 50)}...`);
        // include_recent: false — OpenClaw already has conversation context.
        // Only inject curated preferences, facts, and procedures from Sulcus.
        const res = await client.call("build_context", { prompt: event.prompt, token_budget: 2000, include_recent: false });
        // build_context returns either:
        //   - plain XML string (new format, post-4dca467)
        //   - { context: "...", token_estimate: N } (old format)
        // The MCP client resolves to the parsed JSON if valid, or the raw MCP result object.
        let context: string | undefined;
        if (typeof res === "string") {
          context = res;
        } else if (res?.context) {
          context = res.context;
        } else if (res?.content?.[0]?.text) {
          context = res.content[0].text;
        }
        if (context) {
          api.logger.info(`memory-sulcus: context build successful, injecting ${context.length} chars`);
          return { prependSystemContext: context };
        }
        // Context was empty — inject fallback so LLM still knows about Sulcus
        api.logger.warn(`memory-sulcus: build_context returned empty, injecting fallback awareness`);
        return { prependSystemContext: FALLBACK_AWARENESS };
      } catch (e) {
        // build_context failed — inject fallback so the LLM isn't flying blind
        api.logger.warn(`memory-sulcus: context build failed: ${e} — injecting fallback awareness`);
        return { prependSystemContext: FALLBACK_AWARENESS };
      }
    });

    // agent_end: Do NOT auto-record raw conversation turns.
    // The LLM has record_memory as an MCP tool — it decides what's worth remembering.
    // Auto-recording every turn flooded the store with 2000+ junk episodic nodes
    // containing placeholder vectors and raw JSON conversation payloads.
    api.on("agent_end", async (event: any) => {
      api.logger.debug(`memory-sulcus: agent_end hook triggered for agent ${event.agentId} (no auto-record)`);
    });

    api.registerService({
      id: "memory-sulcus",
      start: () => client.start(),
      stop: () => client.stop()
    });
  }
};

export default sulcusPlugin;
