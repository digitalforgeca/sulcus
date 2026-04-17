import { resolve } from "node:path";
import { existsSync } from "node:fs";
import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";
import { Type } from "@sinclair/typebox";
import { NativeLibLoader } from "./native-loader";
import { loadHooksConfig } from "./hooks-config";
import { importOpenClawHistory } from "./history-import";
import { resolveLibDir, resolveDataDir, ensureDirectories } from "./paths";

// ─── STATIC AWARENESS ───────────────────────────────────────────────────────

function buildStaticAwareness(backendMode: string, namespace: string): string {
  return `## Persistent Memory (Sulcus)
You have Sulcus — a persistent, reactive, thermodynamic memory system with reactive triggers.
Memories survive across sessions. They have heat (0.0–1.0) that decays over time.

**Connection:** Backend: ${backendMode} | Namespace: ${namespace}

**Your memory tools:**
- \`memory_store\` — Save important information (preferences, facts, procedures, decisions, lessons)
  Parameters: content, memory_type (episodic|semantic|preference|procedural|fact)
- \`memory_recall\` — Search memories semantically. Use before answering about past work, decisions, or people.
  Parameters: query, limit

**When to store:** User states a preference, important decision made, correction given, lesson learned, anything worth surviving this session.
**When to search:** Questions about prior work/decisions, context seems incomplete, user references past conversations.

**Memory types:** episodic (events, fast decay) · semantic (knowledge, slow) · preference (opinions, slower) · procedural (how-tos, slowest) · fact (data, slow)`;
}

let STATIC_AWARENESS = buildStaticAwareness("local", "default");

const FALLBACK_AWARENESS = `<sulcus_context token_budget="500">
  <cheatsheet>
    You have Sulcus — persistent memory with reactive triggers.
    STORE:    memory_store (content, memory_type)
    FIND:     memory_recall (query, limit)
    TYPES:    episodic (fast fade), semantic (slow), preference, procedural (slowest), fact
    Context build failed this turn — use memory_recall to search manually.
  </cheatsheet>
</sulcus_context>`;

// ─── HOOKS CONFIG TYPES ──────────────────────────────────────────────────────

interface HookConfig {
  action: string;
  enabled: boolean;
  limit?: number;
  minScore?: number;
  [key: string]: unknown;
}

interface ToolConfig {
  enabled: boolean;
  [key: string]: unknown;
}

interface HooksConfig {
  $schema?: string;
  version?: number;
  hooks: Record<string, HookConfig>;
  tools: Record<string, ToolConfig>;
}

interface HookHandlerCtx {
  sulcusMem: SulcusCloudClient | null;
  backendMode: string;
  namespace: string;
  logger: PluginLogger;
  nativeError?: string | null;
  storeLibPath?: string;
  vectorsLibPath?: string;
  wasmDir?: string;
}

interface PluginLogger {
  debug?: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

type HookHandler = (event: Record<string, unknown>, config: HookConfig, ctx: HookHandlerCtx) => Promise<unknown>;

// ─── HOOK HANDLERS ───────────────────────────────────────────────────────────

const hookHandlers: Record<string, HookHandler> = {
  inject_awareness: async (_event, _config, _ctx) => {
    return { appendSystemContext: STATIC_AWARENESS };
  },

  auto_recall: async (event, config, ctx) => {
    const { sulcusMem, namespace, logger } = ctx;
    if (!sulcusMem) return;
    const agentLabel = (event?.agentId as string) ?? "(unknown)";
    logger.info(`sulcus: auto_recall hook triggered for agent ${agentLabel}`);
    const prompt = typeof event?.prompt === "string" ? event.prompt : "";
    if (!prompt) return;
    try {
      const limit = (config.limit as number) ?? 5;
      logger.debug?.(`sulcus: searching context for prompt: ${prompt.substring(0, 50)}... (namespace: ${namespace})`);
      const res = await sulcusMem.search_memory(prompt, limit, namespace);
      const results = res?.results ?? [];
      if (!results || results.length === 0) {
        return { prependSystemContext: FALLBACK_AWARENESS };
      }
      const items = results.map((r: Record<string, unknown>) => {
        const heat = ((r.current_heat as number) ?? (r.score as number) ?? 0).toFixed(2);
        const mtype = (r.memory_type as string) ?? "unknown";
        const label = (r.label as string) ?? (r.pointer_summary as string) ?? "";
        return `    <memory id="${r.id}" heat="${heat}" type="${mtype}">${label}</memory>`;
      }).join("\n");
      const context = `<sulcus_context token_budget="500" namespace="${namespace}">\n${items}\n</sulcus_context>`;
      logger.info(`sulcus: injecting ${results.length} recalled memories (${context.length} chars)`);
      return { prependSystemContext: context };
    } catch (e) {
      logger.warn(`sulcus: context build failed: ${e} — injecting fallback awareness`);
      return { prependSystemContext: FALLBACK_AWARENESS };
    }
  },

  none: async (event, _config, ctx) => {
    ctx.logger.debug?.(`sulcus: hook fired (action=none) for agent ${(event.agentId as string) ?? "(unknown)"} (no-op)`);
  },

  sivu_auto_capture: async (event, config, ctx) => {
    const { sulcusMem, logger } = ctx;
    if (!sulcusMem) return;

    // Skip captures from system/automated event sources
    const eventTrigger = (event?.trigger as string) ?? "";
    const skippedTriggers = ["exec-event", "cron-event", "heartbeat"];
    if (skippedTriggers.some((t) => eventTrigger === t)) {
      logger.debug?.(`sulcus: sivu_auto_capture — skipping trigger="${eventTrigger}"`);
      return;
    }

    const userMessage = (event?.userMessage ?? event?.prompt ?? event?.text ?? "") as string;
    if (!userMessage || typeof userMessage !== "string") {
      logger.debug?.("sulcus: sivu_auto_capture — no user message in event, skipping");
      return;
    }

    if (isJunkMemory(userMessage)) {
      logger.debug?.(`sulcus: sivu_auto_capture — pre-filtered junk: "${userMessage.substring(0, 50)}..."`);
      return;
    }

    if (!shouldCapture(userMessage)) {
      logger.debug?.("sulcus: sivu_auto_capture — dedup skip");
      return;
    }

    const minConfidence = (config.min_store_confidence as number) ?? 0.5;
    const fallbackOnError = config.fallback_on_error !== false;

    if (sulcusMem instanceof SulcusCloudClient) {
      try {
        const siuResult = await sulcusMem.request("POST", "/api/v2/siu/label", { text: userMessage }) as Record<string, unknown>;
        const storeConf = (siuResult?.store_confidence as number) ?? 0;
        const shouldStore = siuResult?.store === true && storeConf >= minConfidence;
        const memoryType = (siuResult?.memory_type as string) ?? "episodic";
        const modelVersion = (siuResult?.model_version as string) ?? "unknown";

        if (!shouldStore) {
          logger.info(`sulcus: sivu_auto_capture — SIVU rejected (confidence: ${storeConf.toFixed(3)}, model: ${modelVersion}): "${userMessage.substring(0, 60)}..."`);
          return;
        }

        const res = await sulcusMem.add_memory(userMessage, memoryType);
        const typeConf = ((siuResult?.type_confidence as number) ?? 0).toFixed(3);
        logger.info(`sulcus: sivu_auto_capture — stored [${memoryType}] (id: ${res?.id ?? "?"}, sivu_conf: ${storeConf.toFixed(3)}, sicu_conf: ${typeConf}, model: ${modelVersion}): "${userMessage.substring(0, 60)}..."`);
        return;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`sulcus: sivu_auto_capture — SIU v2 endpoint error: ${msg}`);
        if (!fallbackOnError) return;
      }
    }

    try {
      const res = await sulcusMem.add_memory(userMessage, "episodic");
      logger.info(`sulcus: sivu_auto_capture — fallback stored [episodic] (id: ${res?.id ?? "?"}): "${userMessage.substring(0, 60)}..."`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`sulcus: sivu_auto_capture — fallback store failed: ${msg}`);
    }
  },

  /**
   * auto_error_capture — stores tool errors as episodic memories with boosted heat.
   *
   * Fires on after_tool_call when a tool returns an error.
   * Stores the error context so the agent learns from past failures.
   * Skips errors from Sulcus's own tools to avoid self-referential loops.
   */
  auto_error_capture: async (event: any, _config: HookConfig, ctx: HookHandlerCtx) => {
    const { sulcusMem, logger } = ctx;
    const errorText = event?.error?.trim?.();
    if (!errorText || !sulcusMem) return; // No error or no backend — nothing to capture

    const toolName = event?.toolName ?? event?.tool_name ?? "unknown";

    // Skip errors from our own tools to prevent capture loops
    if (typeof toolName === "string" && (
      toolName.startsWith("memory_") ||
      toolName.startsWith("sulcus_") ||
      toolName === "consolidate" ||
      toolName === "evaluate_triggers" ||
      toolName === "export_markdown" ||
      toolName === "import_markdown" ||
      toolName === "siu_label" ||
      toolName === "siu_retrain"
    )) {
      return;
    }

    // Normalize + truncate error text
    const normalized = errorText.replace(/\s+/g, " ").trim();
    const truncated = normalized.length > 500 ? normalized.slice(0, 500) + " [truncated]" : normalized;
    const memoryContent = `Tool '${toolName}' failed: ${truncated}`;

    try {
      const res = await sulcusMem.add_memory(memoryContent, "episodic");
      // Boost heat so error memories persist longer — failures are high-value learnings
      if (res?.id && sulcusMem instanceof SulcusCloudClient) {
        await sulcusMem.request("PATCH", `/api/v1/agent/memory/${res.id}`, {
          current_heat: 0.8,
        }).catch(() => {}); // best-effort boost
      }
      logger.info(`sulcus: auto_error_capture — stored tool error [episodic] (id: ${res?.id ?? "?"}): "${memoryContent.substring(0, 80)}..."`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.debug?.(`sulcus: auto_error_capture — failed to store: ${msg}`);
    }
  },

  pre_compaction_capture: async (event: Record<string, unknown>, _config: HookConfig, ctx: HookHandlerCtx) => {
    const { sulcusMem, logger } = ctx;
    if (!sulcusMem) return;

    const messages = Array.isArray(event?.messages) ? event.messages as Record<string, unknown>[] : [];
    if (messages.length === 0) return;

    const firstUser = messages.find((m) => m.role === "user" || m.type === "human");
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" || m.type === "ai");

    const firstUserText = typeof firstUser?.content === "string"
      ? firstUser.content.substring(0, 200)
      : typeof firstUser?.text === "string"
        ? (firstUser.text as string).substring(0, 200)
        : "(none)";

    const lastAssistantText = typeof lastAssistant?.content === "string"
      ? lastAssistant.content.substring(0, 200)
      : typeof lastAssistant?.text === "string"
        ? (lastAssistant.text as string).substring(0, 200)
        : "(none)";

    const filesModified: string[] = [];
    for (const msg of messages) {
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls as Record<string, unknown>[] : [];
      for (const tc of toolCalls) {
        const name = (tc.name ?? tc.function) as string | undefined;
        if (name === "Write" || name === "Edit" || name === "write" || name === "edit") {
          const input = (tc.input ?? tc.arguments ?? {}) as Record<string, unknown>;
          const fp = input?.file_path ?? input?.path;
          if (fp && typeof fp === "string" && !filesModified.includes(fp)) filesModified.push(fp);
        }
      }
    }

    const summaryParts = [
      `Session compaction — ${messages.length} messages`,
      `First user message: ${firstUserText}`,
      `Last assistant message: ${lastAssistantText}`,
    ];
    if (filesModified.length > 0) summaryParts.push(`Files modified: ${filesModified.join(", ")}`);
    const summary = summaryParts.join("\n");

    if (!shouldCapture(summary)) {
      logger.debug?.("sulcus: pre_compaction_capture — dedup skip");
      return;
    }

    try {
      const res = await sulcusMem.add_memory(summary, "episodic");
      logger.info(`sulcus: pre_compaction_capture — stored session summary (id: ${res?.id ?? "?"})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.debug?.(`sulcus: pre_compaction_capture — store failed: ${msg}`);
    }
  },
};

// ─── CLOUD HTTP CLIENT ───────────────────────────────────────────────────────

class SulcusCloudClient {
  private serverUrl: string;
  private apiKey: string;

  constructor(serverUrl: string, apiKey: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  request(method: string, path: string, body?: unknown): Promise<unknown> {
    return new Promise((resolveP, rejectP) => {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(this.serverUrl + path);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return rejectP(new Error(`SulcusCloudClient: invalid URL ${this.serverUrl}${path}: ${msg}`));
      }

      const isHttps = parsedUrl.protocol === "https:";
      const transport = isHttps ? https : http;

      const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
      const headers: Record<string, string> = {
        "Authorization": `Bearer ${this.apiKey}`,
        "Accept": "application/json",
      };
      if (bodyStr !== undefined) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
      }

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers,
      };

      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          if (!res.statusCode || res.statusCode >= 400) {
            return rejectP(new Error(`SulcusCloudClient: HTTP ${res.statusCode} for ${method} ${path}: ${raw.substring(0, 200)}`));
          }
          if (!raw || raw.trim() === "") return resolveP(null);
          try {
            resolveP(JSON.parse(raw));
          } catch (_e) {
            resolveP(raw);
          }
        });
      });

      req.on("error", (e: Error) => rejectP(new Error(`SulcusCloudClient: network error for ${method} ${path}: ${e.message}`)));
      if (bodyStr !== undefined) req.write(bodyStr);
      req.end();
    });
  }

  async search_memory(query: string, limit?: number, namespace?: string): Promise<{ results: Record<string, unknown>[] }> {
    const body: Record<string, unknown> = { query };
    if (limit !== undefined) body.limit = limit;
    if (namespace !== undefined) body.namespace = namespace;
    const res = await this.request("POST", "/api/v1/agent/search", body) as Record<string, unknown> | null;
    const results = (res?.results ?? res?.items ?? res?.nodes ?? (Array.isArray(res) ? res : [])) as Record<string, unknown>[];
    return { results };
  }

  async add_memory(content: string, memoryType?: string | null): Promise<{ id: string; [key: string]: unknown }> {
    const body: Record<string, unknown> = { label: content };
    if (memoryType) body.memory_type = memoryType;
    const res = await this.request("POST", "/api/v1/agent/nodes", body) as Record<string, unknown> | null;
    return (res ?? { id: "unknown" }) as { id: string; [key: string]: unknown };
  }

  async list_hot_nodes(limit?: number): Promise<{ nodes: Record<string, unknown>[] }> {
    const q = limit ? `?limit=${limit}` : "";
    const res = await this.request("GET", `/api/v1/agent/hot_nodes${q}`) as Record<string, unknown> | unknown[] | null;
    const nodes = (Array.isArray(res) ? res : ((res as Record<string, unknown>)?.hot_nodes ?? (res as Record<string, unknown>)?.nodes ?? [])) as Record<string, unknown>[];
    return { nodes };
  }

  async consolidate(minHeat?: number): Promise<unknown> {
    const body: Record<string, unknown> = {};
    if (minHeat !== undefined) body.min_heat = minHeat;
    return this.request("POST", "/api/v1/agent/consolidate", body);
  }

  async delete_memory(id: string, train?: boolean): Promise<unknown> {
    const trainParam = train ? "true" : "false";
    return this.request("DELETE", `/api/v1/agent/nodes/${encodeURIComponent(id)}?train=${trainParam}`);
  }

  async export_markdown(): Promise<string> {
    const res = await this.request("GET", "/api/v1/agent/export?format=markdown");
    if (typeof res === "string") return res;
    const r = res as Record<string, unknown>;
    return (r?.content ?? r?.markdown ?? JSON.stringify(res, null, 2)) as string;
  }

  async import_markdown(text: string): Promise<unknown> {
    return this.request("POST", "/api/v1/agent/import", { format: "markdown", content: text });
  }

  async evaluate_triggers(event: unknown, contextJson?: string): Promise<unknown> {
    const body: Record<string, unknown> = { event };
    if (contextJson) {
      try { body.context = JSON.parse(contextJson); }
      catch (_e) { body.context = contextJson; }
    }
    return this.request("POST", "/api/v1/triggers/evaluate", body);
  }

  async embed_text(text: string, namespace?: string): Promise<{ embedding: number[]; model: string; dimensions: number } | null> {
    // NOTE: Requires Sulcus server >= v2.4 with /api/v1/agent/embed endpoint.
    // Falls back to null if the endpoint is not available — caller handles gracefully.
    try {
      const body: Record<string, unknown> = { text };
      if (namespace) body.namespace = namespace;
      const res = await this.request("POST", "/api/v1/agent/embed", body) as Record<string, unknown> | null;
      if (!res || !Array.isArray(res.embedding)) return null;
      return {
        embedding: res.embedding as number[],
        model: (res.model as string) ?? "bge-small-en-v1.5",
        dimensions: (res.dimensions as number) ?? (res.embedding as number[]).length,
      };
    } catch (e: unknown) {
      // 404 = endpoint not deployed yet; warn once but don't break anything
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("404")) return null; // endpoint not available on this server version
      throw e;
    }
  }

  async hot_context(limit?: number, namespace?: string, memoryType?: string): Promise<{ results: Record<string, unknown>[] }> {
    const body: Record<string, unknown> = {};
    if (limit !== undefined) body.limit = limit;
    if (namespace !== undefined) body.namespace = namespace;
    if (memoryType !== undefined) body.memory_type = memoryType;
    const res = await this.request("POST", "/api/v1/agent/hot-context", body) as unknown;
    const results = (Array.isArray(res) ? res : []) as Record<string, unknown>[];
    // Normalize: hot-context returns flat array of {node, score}
    return { results: results.map((r) => ({ ...(r.node as Record<string, unknown> ?? r), score: r.score ?? 0 })) };
  }

  async entity_context(entityNames: string[], limit?: number, namespace?: string): Promise<{ entities: Record<string, unknown>[] }> {
    const body: Record<string, unknown> = { entity_names: entityNames };
    if (limit !== undefined) body.limit = limit;
    if (namespace !== undefined) body.namespace = namespace;
    const res = await this.request("POST", "/api/v1/agent/entity-context", body) as Record<string, unknown> | null;
    return { entities: ((res?.entities ?? []) as Record<string, unknown>[]) };
  }

  async log_recall_session(data: {
    namespace?: string;
    agent_id?: string;
    query_text: string;
    memory_ids: string[];
    memory_scores: number[];
    memory_sources: string[];
    token_budget: number;
    tokens_used: number;
    candidates_total: number;
    candidates_selected: number;
    semantic_count: number;
    hot_count: number;
    entity_count: number;
    entity_hints: string[];
  }): Promise<void> {
    // Fire-and-forget — don't block recall on logging
    try {
      await this.request("POST", "/api/v1/agent/recall-log", data);
    } catch {
      // Silently ignore — recall logging is best-effort
    }
  }

  async fetch_recall_weights(namespace?: string): Promise<RecallWeights | null> {
    try {
      const q = namespace ? `?namespace=${encodeURIComponent(namespace)}` : "";
      const res = await this.request("GET", `/api/v1/agent/recall-weights${q}`) as Record<string, unknown> | null;
      if (!res?.ok) return null;
      const w = res.weights as Record<string, unknown> | undefined;
      if (!w) return null;
      return {
        similarity_weight: (w.similarity_weight as number) ?? 0.40,
        heat_weight: (w.heat_weight as number) ?? 0.30,
        recency_weight: (w.recency_weight as number) ?? 0.20,
        source_boost_semantic: (w.source_boost_semantic as number) ?? 0.00,
        source_boost_hot: (w.source_boost_hot as number) ?? 0.05,
        source_boost_entity: (w.source_boost_entity as number) ?? 0.10,
        source_boost_profile: (w.source_boost_profile as number) ?? 0.15,
        model_version: (w.model_version as number) ?? 0,
        source: (w.source as string) ?? "default",
      };
    } catch {
      return null;
    }
  }

  async probe(): Promise<boolean> {
    try {
      await this.search_memory("probe", 1);
      return true;
    } catch {
      return false;
    }
  }
}

// NativeLibLoader extracted to ./native-loader.ts (no network code)

// ─── PRE-SEND FILTER ─────────────────────────────────────────────────────────

const JUNK_PATTERNS: RegExp[] = [
  /^(HEARTBEAT_OK|NO_REPLY|NOOP)$/i,
  /^\s*$/,
  /^system:\s/i,
  /^(Gateway restart|Plugin .* updated|Discord inbound)/i,
  /^\[?(message_id|sender_id|conversation_label|schema)[\]":]/i,
  /^```json\s*\{?\s*"(message_id|sender_id|schema|chat_id)/i,
  /^Conversation info \(untrusted/i,
  /^Sender \(untrusted/i,
  /^UNTRUSTED (channel|Discord)/i,
  /^<<<EXTERNAL_UNTRUSTED_CONTENT/i,
  /^Runtime:/i,
  /tool_call|function_call|<function_calls>/i,
  /\[Inter-session message\]\s*sourceSession=/i,
  /<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>/,
  /<<<END_UNTRUSTED_CHILD_RESULT>>>/,
  /\[Internal task completion event\]/i,
  /^source:\s*subagent/im,
  /session_key:\s*agent:main:subagent:/i,
  /^Sulcus validation cycle\./i,
  /^Heartbeat prompt:/i,
  /OpenClaw runtime context \(internal\)/i,
  /\b(sk-[a-f0-9]{40,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,})\b/,
  /\b(api[_-]?key|secret|password|token)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{16,}/i,
];

function isJunkMemory(text: string): boolean {
  if (!text || text.length < 10) return true;
  if (text.length > 10000) return true;
  for (const pattern of JUNK_PATTERNS) {
    if (pattern.test(text.trim())) return true;
  }
  return false;
}

// ─── CAPTURE DEDUP ───────────────────────────────────────────────────────────

const captureDedup = new Map<string, number>();
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function shouldCapture(content: string): boolean {
  const key = content.substring(0, 120) + "|" + content.length;
  const now = Date.now();
  for (const [k, ts] of captureDedup.entries()) {
    if (now - ts > DEDUP_WINDOW_MS) captureDedup.delete(k);
  }
  if (captureDedup.has(key)) return false;
  captureDedup.set(key, now);
  return true;
}

// loadHooksConfig extracted to ./hooks-config.ts (no network code)

// ─── RELATIVE TIME FORMATTER ─────────────────────────────────────────────────

function formatRelativeTime(isoTimestamp: string): string {
  try {
    const dt = new Date(isoTimestamp);
    const now = new Date();
    const seconds = (now.getTime() - dt.getTime()) / 1000;
    const minutes = seconds / 60;
    const hours = seconds / 3600;
    const days = seconds / 86400;
    if (minutes < 2) return "just now";
    if (minutes < 60) return `${Math.floor(minutes)}m ago`;
    if (hours < 24) return `${Math.floor(hours)}h ago`;
    if (days < 7) return `${Math.floor(days)}d ago`;
    const month = dt.toLocaleString("en", { month: "short" });
    if (dt.getFullYear() === now.getFullYear()) return `${dt.getDate()} ${month}`;
    return `${dt.getDate()} ${month}, ${dt.getFullYear()}`;
  } catch {
    return "";
  }
}

// ─── TOKEN BUDGET UTILITIES ──────────────────────────────────────────────────

/** Estimate token count from character length (rough heuristic: ~4 chars/token for English). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Extract likely entity names from a prompt using lightweight heuristics.
 *  Catches: proper nouns (capitalized words), @mentions, "quoted terms", #hashtags.
 *  Not an NER model — fast regex for the hot path. SIRU will do better long-term.
 */
function extractEntityHints(prompt: string): string[] {
  const entities = new Set<string>();
  // @mentions (Discord style)
  for (const m of prompt.matchAll(/@(\w+)/g)) entities.add(m[1].toLowerCase());
  // "quoted terms"
  for (const m of prompt.matchAll(/["']([^"']{2,40})["']/g)) entities.add(m[1].toLowerCase());
  // Capitalized multi-word names (e.g., "Sulcus Vault", "Thor", "Keycloak")
  for (const m of prompt.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g)) {
    const name = m[1].toLowerCase();
    // Filter common sentence starters and noise words
    if (name.length > 2 && !COMMON_SENTENCE_STARTERS.has(name)) entities.add(name);
  }
  return Array.from(entities).slice(0, 8); // cap at 8 to avoid hammering the graph
}

const COMMON_SENTENCE_STARTERS = new Set([
  "the", "this", "that", "these", "those", "here", "there", "what", "when",
  "where", "which", "who", "how", "why", "can", "could", "would", "should",
  "will", "does", "did", "has", "have", "had", "are", "were", "was", "been",
  "being", "also", "just", "now", "then", "but", "and", "not", "for", "let",
  "yes", "hey", "sure", "good", "great", "nice", "please", "thanks",
]);

// ─── SDK RECALL HANDLER (for before_prompt_build with prependContext) ──────────

interface RecallWeights {
  similarity_weight: number;
  heat_weight: number;
  recency_weight: number;
  source_boost_semantic: number;
  source_boost_hot: number;
  source_boost_entity: number;
  source_boost_profile: number;
  model_version: number;
  source: string; // "default" | "learned"
}

interface ProfileCache {
  preferences: Record<string, unknown>[];
  facts: Record<string, unknown>[];
  cachedAt: number;
}

interface RecallCandidate {
  id: string;
  label: string;
  memoryType: string;
  heat: number;
  score: number;         // raw similarity/heat score
  compositeScore: number; // blended ranking score
  source: "semantic" | "hot" | "entity" | "profile";
  updatedAt?: string;
}

function buildSdkRecallHandler(
  sulcusMem: SulcusCloudClient,
  namespace: string,
  maxResults: number,
  profileFrequency: number,
  logger: PluginLogger,
  tokenBudget: number = 500,
  hotContextEnabled: boolean = true,
  entityContextEnabled: boolean = true
) {
  let turnCount = 0;
  let profileCache: ProfileCache | null = null;
  // ── Recall TTL cache (cache-friendly: reuse same context within TTL window) ──
  let recallCache: { context: string; cachedAt: number } | null = null;
  const RECALL_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // ── SIRU: Learned recall weights (fetched once, refreshed every 30 min) ──
  let siruWeights: RecallWeights | null = null;
  let siruWeightsFetchedAt = 0;
  const SIRU_WEIGHTS_TTL_MS = 30 * 60 * 1000; // 30 minutes

  return async (event: Record<string, unknown>, _ctx: unknown): Promise<{ prependContext: string } | undefined> => {
    const prompt = typeof event?.prompt === "string" ? event.prompt : "";
    if (!prompt || prompt.length < 5) return undefined;

    turnCount++;
    const includeProfile = turnCount === 1 || turnCount % profileFrequency === 0;

    // ── Recall TTL: reuse cached context if still fresh (avoids cache-busting) ──
    if (recallCache && (Date.now() - recallCache.cachedAt) < RECALL_TTL_MS) {
      logger.info(`sulcus: recall cache hit (age ${Math.round((Date.now() - recallCache.cachedAt) / 1000)}s, TTL ${RECALL_TTL_MS / 1000}s)`);
      return { prependContext: recallCache.context };
    }

    try {
      // ── Multi-Signal Retrieval (parallel) ─────────────────────────────────
      const candidates: RecallCandidate[] = [];
      const seenIds = new Set<string>();

      // Helper: add candidate if not already seen
      const addCandidate = (r: Record<string, unknown>, source: RecallCandidate["source"], fallbackScore: number) => {
        const id = (r.id as string) ?? "";
        if (!id || seenIds.has(id)) return;
        seenIds.add(id);
        const heat = (r.current_heat as number) ?? (r.heat as number) ?? 0;
        const score = (r.score as number) ?? fallbackScore;
        const label = (r.label ?? r.pointer_summary ?? r.id ?? "") as string;
        candidates.push({
          id,
          label,
          memoryType: (r.memory_type as string) ?? "episodic",
          heat,
          score,
          compositeScore: 0, // computed after collection
          source,
          updatedAt: r.updated_at as string | undefined,
        });
      };

      // Signal 1: Semantic search (existing — primary signal)
      const semanticPromise = sulcusMem.search_memory(prompt, maxResults, namespace)
        .then((res) => {
          for (const r of (res?.results ?? [])) addCandidate(r, "semantic", 0.5);
        })
        .catch((e) => logger.warn(`sulcus: semantic search failed: ${e}`));

      // Signal 2: Hot context (always-loaded high-heat memories)
      const hotPromise = hotContextEnabled
        ? sulcusMem.hot_context(Math.min(maxResults, 5), namespace)
            .then((res) => {
              for (const r of (res?.results ?? [])) addCandidate(r, "hot", 0.3);
            })
            .catch((e) => logger.debug?.(`sulcus: hot-context failed (non-fatal): ${e}`))
        : Promise.resolve();

      // Signal 3: Entity-context (graph neighbors of mentioned entities)
      const entityHints = entityContextEnabled ? extractEntityHints(prompt) : [];
      const entityPromise = (entityContextEnabled && entityHints.length > 0)
        ? sulcusMem.entity_context(entityHints, 3, namespace)
            .then((res) => {
              for (const entity of (res?.entities ?? [])) {
                const relatedMems = (entity.related_memories as Record<string, unknown>[]) ?? [];
                for (const r of relatedMems) addCandidate(r, "entity", 0.4);
              }
            })
            .catch((e) => logger.debug?.(`sulcus: entity-context failed (non-fatal): ${e}`))
        : Promise.resolve();

      // Run all signals in parallel
      await Promise.all([semanticPromise, hotPromise, entityPromise]);

      // ── Profile fetch (periodic) ──────────────────────────────────────────
      let preferences: Record<string, unknown>[] = [];
      let facts: Record<string, unknown>[] = [];

      if (includeProfile) {
        try {
          const prefRes = await sulcusMem.search_memory("user preference", Math.min(maxResults, 5), namespace);
          const factRes = await sulcusMem.search_memory("fact data knowledge", Math.min(maxResults, 5), namespace);
          preferences = (prefRes?.results ?? []).filter((r) => r.memory_type === "preference");
          facts = (factRes?.results ?? []).filter((r) => r.memory_type === "fact");
          profileCache = { preferences, facts, cachedAt: Date.now() };
          // Add profile items as candidates too (for dedup and budget)
          for (const r of preferences) addCandidate(r, "profile", 0.6);
          for (const r of facts) addCandidate(r, "profile", 0.5);
        } catch {
          // profile fetch failed — use cache
          if (profileCache) {
            preferences = profileCache.preferences;
            facts = profileCache.facts;
          }
        }
      } else if (profileCache) {
        preferences = profileCache.preferences;
        facts = profileCache.facts;
        for (const r of [...preferences, ...facts]) addCandidate(r, "profile", 0.5);
      }

      if (candidates.length === 0) return undefined;

      // ── SIRU: Fetch learned weights (once per TTL window) ─────────────────
      if (!siruWeights || (Date.now() - siruWeightsFetchedAt) > SIRU_WEIGHTS_TTL_MS) {
        try {
          const fetched = await sulcusMem.fetch_recall_weights(namespace);
          if (fetched) {
            siruWeights = fetched;
            siruWeightsFetchedAt = Date.now();
            if (fetched.source === "learned") {
              logger.info(`sulcus: SIRU using learned weights v${fetched.model_version} (sim=${fetched.similarity_weight.toFixed(2)}, heat=${fetched.heat_weight.toFixed(2)}, rec=${fetched.recency_weight.toFixed(2)})`);
            }
          }
        } catch {
          // Non-fatal — use defaults or cached weights
        }
      }

      // ── Composite Scoring (SIRU-adaptive) ─────────────────────────────────
      const w = siruWeights ?? {
        similarity_weight: 0.40, heat_weight: 0.30, recency_weight: 0.20,
        source_boost_semantic: 0.00, source_boost_hot: 0.05,
        source_boost_entity: 0.10, source_boost_profile: 0.15,
        model_version: 0, source: "default",
      };

      const now = Date.now();
      for (const c of candidates) {
        const similarity = c.source === "semantic" ? c.score : (c.score * 0.5);
        const heatSignal = c.heat;
        const recency = c.updatedAt
          ? Math.max(0, 1 - (now - new Date(c.updatedAt).getTime()) / (30 * 24 * 60 * 60 * 1000)) // decays over 30 days
          : 0.3;
        const sourceBoost = c.source === "semantic" ? w.source_boost_semantic
          : c.source === "entity" ? w.source_boost_entity
          : c.source === "hot" ? w.source_boost_hot
          : c.source === "profile" ? w.source_boost_profile
          : 0.0;
        c.compositeScore = (similarity * w.similarity_weight) + (heatSignal * w.heat_weight) + (recency * w.recency_weight) + sourceBoost;
      }

      // Sort by composite score descending, then by stable ID for deterministic ordering
      // (cache-friendly: same memories → same bytes → cache hit)
      candidates.sort((a, b) => {
        const scoreDiff = b.compositeScore - a.compositeScore;
        if (Math.abs(scoreDiff) > 0.01) return scoreDiff; // meaningful score difference
        return a.id.localeCompare(b.id); // stable tiebreaker
      });

      // ── Token Budget Assembly ─────────────────────────────────────────────
      const intro =
        "The following is background context from long-term memory. Use it silently to inform your understanding — only reference it when the conversation naturally calls for it.";
      const wrapperOverhead = estimateTokens(
        `<sulcus_context token_budget="${tokenBudget}" namespace="${namespace}">\n${intro}\n\n## Relevant Memories\n\n</sulcus_context>`
      );
      let remainingBudget = tokenBudget - wrapperOverhead;

      const selectedLines: string[] = [];
      const profileLines: string[] = [];

      for (const c of candidates) {
        if (remainingBudget <= 0) break;

        // Cache-friendly: use stable confidence bands instead of volatile exact percentages
        // and omit relative timestamps ("3h ago" changes every hour = cache bust)
        const band = c.compositeScore >= 0.8 ? "high" : c.compositeScore >= 0.5 ? "mid" : "low";
        const line = `- [${band}] ${c.label}`;
        const lineCost = estimateTokens(line);

        if (lineCost > remainingBudget) {
          // Try to fit a trimmed version (first 120 chars of label)
          const trimmedLabel = c.label.length > 120 ? c.label.substring(0, 120) + "..." : c.label;
          const trimmedLine = `- [${band}] ${trimmedLabel}`;
          const trimmedCost = estimateTokens(trimmedLine);
          if (trimmedCost <= remainingBudget) {
            if (c.source === "profile") profileLines.push(trimmedLine);
            else selectedLines.push(trimmedLine);
            remainingBudget -= trimmedCost;
          }
          continue;
        }

        if (c.source === "profile") profileLines.push(line);
        else selectedLines.push(line);
        remainingBudget -= lineCost;
      }

      if (selectedLines.length === 0 && profileLines.length === 0) return undefined;

      const sections: string[] = [];
      if (profileLines.length > 0) {
        sections.push(`## User Profile\n${profileLines.join("\n")}`);
      }
      if (selectedLines.length > 0) {
        sections.push(`## Relevant Memories\n${selectedLines.join("\n")}`);
      }

      const context = `<sulcus_context token_budget="${tokenBudget}" namespace="${namespace}">\n${intro}\n\n${sections.join("\n\n")}\n</sulcus_context>`;
      const actualTokens = estimateTokens(context);

      logger.info(`sulcus: recall injecting context (${context.length} chars, ~${actualTokens} tokens, budget ${tokenBudget}, ${candidates.length} candidates → ${selectedLines.length + profileLines.length} selected, signals: semantic+${hotContextEnabled ? "hot+" : ""}${entityHints.length > 0 ? `entity(${entityHints.join(",")})` : ""}, turn ${turnCount})`);

      // Fire-and-forget: log recall session for SIRU training data
      const selected = candidates.filter(c => selectedLines.some(l => l.includes(c.label.substring(0, 40))) || profileLines.some(l => l.includes(c.label.substring(0, 40))));
      sulcusMem.log_recall_session({
        namespace,
        query_text: prompt,
        memory_ids: selected.map(c => c.id),
        memory_scores: selected.map(c => c.compositeScore),
        memory_sources: selected.map(c => c.source),
        token_budget: tokenBudget,
        tokens_used: actualTokens,
        candidates_total: candidates.length,
        candidates_selected: selectedLines.length + profileLines.length,
        semantic_count: candidates.filter(c => c.source === "semantic").length,
        hot_count: candidates.filter(c => c.source === "hot").length,
        entity_count: candidates.filter(c => c.source === "entity").length,
        entity_hints: entityHints,
      }).catch(() => {}); // truly fire-and-forget

      // Cache the result for TTL window (avoids re-query + cache-busting on next turn)
      recallCache = { context, cachedAt: Date.now() };

      return { prependContext: context };
    } catch (err) {
      logger.warn(`sulcus: SDK recall failed: ${err}`);
      return undefined;
    }
  };
}

// ─── MEMORY RUNTIME BUILDER ───────────────────────────────────────────────────

function buildMemoryRuntime(sulcusMem: SulcusCloudClient, backendMode: string) {
  const searchManager = {
    status() {
      return {
        backend: "builtin" as const,
        provider: "sulcus",
        model: backendMode === "cloud" ? "sulcus-cloud" : "sulcus-local",
        custom: { backendMode, transport: backendMode === "cloud" ? "remote" : "local" },
      };
    },
    async probeEmbeddingAvailability() {
      try {
        const ok = await sulcusMem.probe();
        return { ok };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "sulcus unreachable" };
      }
    },
    async probeVectorAvailability() { return true; },
    async sync() { /* cloud sync is continuous */ },
    async close() { /* no-op for HTTP client */ },
  };

  return {
    async getMemorySearchManager() { return { manager: searchManager }; },
    resolveMemoryBackendConfig() { return { backend: "builtin" as const }; },
    async closeAllMemorySearchManagers() { /* no-op */ },
  };
}

// ─── PROMPT SECTION BUILDER ───────────────────────────────────────────────────

function buildPromptSection(params: { availableTools: Set<string> }): string[] {
  const hasRecall = params.availableTools.has("memory_recall");
  const hasStore = params.availableTools.has("memory_store");
  if (!hasRecall && !hasStore) return [];

  const lines: string[] = [
    "## Memory (Sulcus)",
    "",
    "You have persistent thermodynamic memory powered by Sulcus.",
    "Relevant memories are automatically injected at the start of each conversation.",
    "",
  ];

  if (hasRecall) lines.push("- Use `memory_recall` to search prior conversations, preferences, and facts.");
  if (hasStore) lines.push("- Use `memory_store` to save information the user asks you to remember.");
  if (params.availableTools.has("memory_delete")) lines.push("- Use `memory_delete` to remove incorrect or stale memories.");
  if (params.availableTools.has("memory_status")) lines.push("- Use `memory_status` to check backend connection and hot nodes.");
  if (params.availableTools.has("consolidate")) lines.push("- Use `consolidate` to prune cold memories below a heat threshold.");
  if (params.availableTools.has("export_markdown")) lines.push("- Use `export_markdown` to export all memories as Markdown.");
  if (params.availableTools.has("import_markdown")) lines.push("- Use `import_markdown` to import memories from a Markdown document.");
  if (params.availableTools.has("evaluate_triggers")) lines.push("- Use `evaluate_triggers` to evaluate reactive memory triggers.");

  lines.push("");
  lines.push("Memory types: episodic (events, fast decay), semantic (knowledge, slow), preference (opinions, slower), procedural (how-tos, slowest), fact (data, slow)");

  return lines;
}

// ─── TOOL DEFINITIONS ────────────────────────────────────────────────────────

interface ToolDeps {
  sulcusMem: SulcusCloudClient | null;
  backendMode: string;
  namespace: string;
  nativeLoader: NativeLibLoader;
  storeLibPath: string;
  vectorsLibPath: string;
  wasmDir: string;
  logger: PluginLogger;
  isAvailable: boolean;
  siuRequest: ((method: string, path: string, body?: unknown) => Promise<unknown>) | null;
}

interface ToolDefinition {
  schema: Record<string, unknown>;
  options: { name: string };
  makeExecute: (deps: ToolDeps) => (id: string, params: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; details?: Record<string, unknown> }>;
}

const toolDefinitions: Record<string, ToolDefinition> = {
  memory_recall: {
    schema: {
      name: "memory_recall",
      label: "Memory Recall",
      description: "Search Sulcus memory for relevant context",
      parameters: Type.Object({
        query: Type.String({ description: "Search query string." }),
        limit: Type.Optional(Type.Number({ default: 5, description: "Maximum number of results to return (1-10)." })),
        namespace: Type.Optional(Type.String({ description: "Namespace to search. Defaults to your own namespace." })),
      }),
    },
    options: { name: "memory_recall" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) =>
      async (_id, params) => {
        if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
        const searchNamespace = (params.namespace as string | undefined) ?? namespace;
        const res = await sulcusMem.search_memory(params.query as string, (params.limit as number | undefined) ?? 5, searchNamespace);
        const results = res?.results ?? [];
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          details: { results: results as unknown as Record<string, unknown>[], backend: backendMode, namespace: searchNamespace },
        };
      },
  },

  memory_store: {
    schema: {
      name: "memory_store",
      label: "Memory Store",
      description: "Record information in Sulcus memory. Supports Markdown formatting. You control the memory type at creation time.",
      parameters: Type.Object({
        content: Type.String({ description: "Memory content. Supports Markdown formatting for structured content." }),
        memory_type: Type.Optional(Type.Union([
          Type.Literal("episodic"), Type.Literal("semantic"), Type.Literal("preference"),
          Type.Literal("procedural"), Type.Literal("fact"),
        ], { description: "Memory type. Default: episodic" })),
        train: Type.Optional(Type.Boolean({ description: "Signal the SIU to learn from this manual store. Default: false" })),
      }),
    },
    options: { name: "memory_store" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable, logger }) =>
      async (_id, params) => {
        const content = params.content as string;
        if (isJunkMemory(content)) {
          logger.debug?.(`sulcus: filtered junk memory: "${content.substring(0, 50)}..."`);
          return { content: [{ type: "text", text: "Filtered: content looks like system noise, not a meaningful memory." }], details: { filtered: true } };
        }
        if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
        const mtype = (params.memory_type as string | undefined) || "episodic";
        const res = await sulcusMem.add_memory(content, mtype);
        const nodeId = res?.id ?? "unknown";
        let trainResult: string | null = null;
        if (params.train === true) {
          try {
            await sulcusMem.request("POST", "/api/v2/siu/signal", {
              memory_id: nodeId, signal_type: "accept", corrected_store: true,
              corrected_type: mtype, content_snapshot: content, source: "plugin",
            });
            trainResult = "training signal submitted";
            logger.info(`sulcus: SIU training signal sent for memory ${nodeId} (store, ${mtype})`);
          } catch (e: unknown) {
            trainResult = `training signal failed: ${e instanceof Error ? e.message : e}`;
            logger.warn(`sulcus: SIU training signal failed: ${trainResult}`);
          }
        }
        return {
          content: [{ type: "text", text: `Stored [${mtype}] memory (id: ${nodeId}) → backend: ${backendMode}, namespace: ${namespace}${trainResult ? ` | SIU: ${trainResult}` : ""}` }],
          details: { ...res, id: nodeId, memory_type: mtype, backend: backendMode, namespace, train: trainResult as unknown as Record<string, unknown> },
        };
      },
  },

  memory_status: {
    schema: {
      name: "memory_status",
      label: "Memory Status",
      description: "Check Sulcus memory backend status: connection, namespace, capabilities, and hot nodes.",
      parameters: Type.Object({}),
    },
    options: { name: "memory_status" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, storeLibPath, vectorsLibPath, wasmDir, isAvailable }) =>
      async (_id, _params) => {
        if (!isAvailable || !sulcusMem) {
          return { content: [{ type: "text", text: JSON.stringify({ status: "unavailable", backend: backendMode, namespace, error: nativeLoader.error || "not loaded", storeLib: storeLibPath, vectorsLib: vectorsLibPath, wasmDir }, null, 2) }] };
        }
        try {
          const [statusInfo, hotNodes] = await Promise.all([
            sulcusMem.request("GET", "/api/v1/agent/memory/status").catch(() => null),
            sulcusMem.list_hot_nodes(20),
          ]);
          const nodeList = hotNodes?.nodes ?? [];
          const si = statusInfo as Record<string, unknown> | null;
          return {
            content: [{ type: "text", text: JSON.stringify({ status: "ok", backend: backendMode, namespace, ...(si?.capabilities ? { capabilities: si.capabilities } : {}), ...(si?.stats ? { stats: si.stats } : {}), hot_node_count: nodeList.length, hot_nodes: nodeList }, null, 2) }],
            details: { status: "ok", backend: backendMode, namespace, count: nodeList.length },
          };
        } catch (e: unknown) {
          return { content: [{ type: "text", text: JSON.stringify({ status: "error", backend: backendMode, namespace, error: e instanceof Error ? e.message : String(e) }, null, 2) }] };
        }
      },
  },

  consolidate: {
    schema: {
      name: "consolidate",
      label: "Memory Consolidate",
      description: "Consolidate cold memories: merges, prunes, or archives nodes below the given heat threshold.",
      parameters: Type.Object({ min_heat: Type.Optional(Type.Number({ default: 0.1, description: "Heat threshold (0.0–1.0)." })) }),
    },
    options: { name: "consolidate" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) =>
      async (_id, params) => {
        if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
        const res = await sulcusMem.consolidate((params.min_heat as number | undefined) ?? 0.1);
        return { content: [{ type: "text", text: JSON.stringify({ result: res, backend: backendMode, namespace }, null, 2) }], details: { result: res as Record<string, unknown>, backend: backendMode, namespace } };
      },
  },

  export_markdown: {
    schema: {
      name: "export_markdown",
      label: "Export Memory (Markdown)",
      description: "Export all memories in the current namespace as a Markdown document.",
      parameters: Type.Object({}),
    },
    options: { name: "export_markdown" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) =>
      async (_id, _params) => {
        if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
        const markdown = await sulcusMem.export_markdown();
        return { content: [{ type: "text", text: markdown }], details: { backend: backendMode, namespace, length: markdown.length } };
      },
  },

  import_markdown: {
    schema: {
      name: "import_markdown",
      label: "Import Memory (Markdown)",
      description: "Import memories from a Markdown document into the current namespace.",
      parameters: Type.Object({ text: Type.String({ description: "Markdown content to import." }) }),
    },
    options: { name: "import_markdown" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) =>
      async (_id, params) => {
        if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
        const res = await sulcusMem.import_markdown(params.text as string);
        return { content: [{ type: "text", text: JSON.stringify({ result: res, backend: backendMode, namespace }, null, 2) }], details: { result: res as Record<string, unknown>, backend: backendMode, namespace } };
      },
  },

  evaluate_triggers: {
    schema: {
      name: "evaluate_triggers",
      label: "Evaluate Memory Triggers",
      description: "Evaluate reactive memory triggers against an event and context.",
      parameters: Type.Object({
        event: Type.String({ description: "Event name to evaluate triggers against (e.g. 'agent_end', 'user_message')." }),
        context_json: Type.Optional(Type.String({ description: "JSON string of additional context." })),
      }),
    },
    options: { name: "evaluate_triggers" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) =>
      async (_id, params) => {
        if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
        const res = await sulcusMem.evaluate_triggers(params.event, (params.context_json as string | undefined) ?? "{}");
        return { content: [{ type: "text", text: JSON.stringify({ result: res, backend: backendMode, namespace }, null, 2) }], details: { result: res as Record<string, unknown>, backend: backendMode, namespace } };
      },
  },

  memory_delete: {
    schema: {
      name: "memory_delete",
      label: "Delete Memory",
      description: "Delete a memory node by ID. With train=true (default), trains SIVU to reject similar content.",
      parameters: Type.Object({
        id: Type.String({ description: "Memory node ID to delete." }),
        train: Type.Optional(Type.Boolean({ default: true, description: "Train SIVU to reject similar content (default true)." })),
      }),
    },
    options: { name: "memory_delete" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) =>
      async (_id, params) => {
        if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
        const train = params.train !== false;
        const res = await sulcusMem.delete_memory(params.id as string, train);
        return {
          content: [{ type: "text", text: `Deleted memory ${params.id as string}${train ? " (trained SIVU to reject similar)" : ""}. Backend: ${backendMode}, namespace: ${namespace}` }],
          details: { id: params.id as string, trained: train, result: res as Record<string, unknown>, backend: backendMode, namespace },
        };
      },
  },

  siu_label: {
    schema: {
      name: "siu_label",
      label: "SIU Label",
      description: "Classify text using SIU v2 — returns SIVU store/reject decision and SICU memory type classification.",
      parameters: Type.Object({
        text: Type.String({ description: "Text to classify." }),
        classify_only: Type.Optional(Type.Boolean({ description: "Skip SIVU quality gate, only run SICU type classification." })),
      }),
    },
    options: { name: "siu_label" },
    makeExecute: ({ siuRequest, logger }) =>
      async (_id, params) => {
        if (!siuRequest) return { content: [{ type: "text", text: "SIU label requires cloud backend (serverUrl + apiKey)." }] };
        try {
          const res = await siuRequest("POST", "/api/v2/siu/label", { text: params.text as string, classify_only: params.classify_only ?? false });
          return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], details: res as Record<string, unknown> };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(`sulcus: siu_label failed: ${msg}`);
          return { content: [{ type: "text", text: `SIU label failed: ${msg}` }] };
        }
      },
  },

  siu_status: {
    schema: {
      name: "siu_status",
      label: "SIU Status",
      description: "Check SIU v2 model availability, deployed versions, and training signal statistics.",
      parameters: Type.Object({}),
    },
    options: { name: "siu_status" },
    makeExecute: ({ siuRequest, logger }) =>
      async (_id, _params) => {
        if (!siuRequest) return { content: [{ type: "text", text: "SIU status requires cloud backend." }] };
        try {
          const res = await siuRequest("GET", "/api/v2/siu/status");
          return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], details: res as Record<string, unknown> };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(`sulcus: siu_status failed: ${msg}`);
          return { content: [{ type: "text", text: `SIU status failed: ${msg}` }] };
        }
      },
  },

  siu_retrain: {
    schema: {
      name: "siu_retrain",
      label: "SIU Retrain",
      description: "Trigger an async retrain of SIU v2 models using accumulated training signals.",
      parameters: Type.Object({}),
    },
    options: { name: "siu_retrain" },
    makeExecute: ({ siuRequest, logger }) =>
      async (_id, _params) => {
        if (!siuRequest) return { content: [{ type: "text", text: "SIU retrain requires cloud backend." }] };
        try {
          const res = await siuRequest("POST", "/api/v2/siu/retrain");
          return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], details: res as Record<string, unknown> };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(`sulcus: siu_retrain failed: ${msg}`);
          return { content: [{ type: "text", text: `SIU retrain failed: ${msg}` }] };
        }
      },
  },

  trigger_feedback: {
    schema: {
      name: "trigger_feedback",
      label: "Trigger Feedback",
      description: "Record feedback on a trigger fire (for SITU training).",
      parameters: Type.Object({
        feedback_type: Type.String({ description: 'One of: "false_positive", "false_negative", "correct", "wrong_action"' }),
        trigger_id: Type.Optional(Type.String({ description: "UUID of the trigger rule" })),
        trigger_log_id: Type.Optional(Type.String({ description: "UUID of the trigger fire log entry" })),
        event_type: Type.Optional(Type.String({ description: "Event type: memory_created, heat_threshold, recall, etc." })),
        memory_id: Type.Optional(Type.String({ description: "UUID of the memory involved" })),
        expected_action: Type.Optional(Type.String({ description: "What should have happened: fire, no_fire, different_action" })),
        notes: Type.Optional(Type.String({ description: "Free-text explanation of the feedback" })),
      }),
    },
    options: { name: "trigger_feedback" },
    makeExecute: ({ siuRequest, logger }) =>
      async (_id, params) => {
        if (!siuRequest) return { content: [{ type: "text", text: "Trigger feedback requires cloud backend." }] };
        try {
          const res = await siuRequest("POST", "/api/v1/triggers/feedback", params);
          return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], details: res as Record<string, unknown> };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(`sulcus: trigger_feedback failed: ${msg}`);
          return { content: [{ type: "text", text: `Trigger feedback failed: ${msg}` }] };
        }
      },
  },

  __sulcus_workflow__: {
    schema: {
      name: "__sulcus_workflow__",
      label: "Sulcus Workflow",
      description: "Call this when you are unsure what to do next with Sulcus memory tools. Returns a step-by-step workflow checklist so you always know the right action.",
      parameters: Type.Object({}),
    },
    options: { name: "__sulcus_workflow__" },
    makeExecute: (_deps: ToolDeps) =>
      async (_id: string, _params: Record<string, unknown>) => {
        const workflow = [
          { step: 1, action: "search first", tool: "memory_recall", description: "Before starting work, search memory for relevant context from prior sessions." },
          { step: 2, action: "store decisions/patterns/learnings", tool: "memory_store", description: "After significant work, store important decisions, patterns, corrections, or learnings." },
          { step: 3, action: "boost important memories", tool: "PATCH /api/v1/agent/memory/:id", description: "Use PATCH to set current_heat=0.9 on memories that should persist longer (memory_boost not yet exposed as a tool)." },
          { step: 4, action: "check triggers", tool: "evaluate_triggers", description: "Evaluate reactive rules to see if any triggers should fire based on current context." },
          { step: 5, action: "export if needed", tool: "export_markdown", description: "Export all memories as Markdown for backup or review." },
        ];
        return {
          content: [{ type: "text", text: JSON.stringify(workflow, null, 2) }],
          details: { workflow: workflow as unknown as Record<string, unknown> },
        };
      },
  },
};

// importOpenClawHistory extracted to ./history-import.ts (file I/O isolated from network code)

// ─── PLUGIN ──────────────────────────────────────────────────────────────────

const sulcusPlugin = {
  id: "openclaw-sulcus",
  name: "Sulcus vMMU",
  description: "Sulcus-backed vMMU memory for OpenClaw — thermodynamic decay, reactive triggers, local-first",
  kind: "memory" as const,

  register(api: Record<string, unknown>) {
    const logger = api.logger as PluginLogger;
    const pluginConfig = (api.pluginConfig ?? {}) as Record<string, unknown>;

    // ── Configuration ──
    const libDir = resolveLibDir(pluginConfig?.libDir as string | undefined);
    const dataDir = resolveDataDir();
    ensureDirectories([libDir, dataDir], logger);
    }

    const storeLibPath = pluginConfig?.storeLibPath
      ? resolve(pluginConfig.storeLibPath as string)
      : resolve(libDir, process.platform === "darwin" ? "libsulcus_store.dylib" : "libsulcus_store.so");

    const vectorsLibPath = pluginConfig?.vectorsLibPath
      ? resolve(pluginConfig.vectorsLibPath as string)
      : resolve(libDir, process.platform === "darwin" ? "libsulcus_vectors.dylib" : "libsulcus_vectors.so");

    const wasmDir = pluginConfig?.wasmDir
      ? resolve(pluginConfig.wasmDir as string)
      : resolve(__dirname, "wasm");

    const serverUrl = pluginConfig?.serverUrl as string | undefined;
    const apiKey = pluginConfig?.apiKey as string | undefined;

    const agentId = pluginConfig?.agentId as string | undefined;
    const namespace = pluginConfig?.namespace === "default" && agentId
      ? agentId
      : ((pluginConfig?.namespace as string | undefined) || agentId || "default");

    // New config options (v4.0.0)
    const autoRecall: boolean = (pluginConfig?.autoRecall as boolean | undefined) ?? false;
    const autoCapture: boolean = (pluginConfig?.autoCapture as boolean | undefined) ?? false;
    const maxRecallResults: number = Math.min(20, Math.max(1, (pluginConfig?.maxRecallResults as number | undefined) ?? 5));
    const profileFrequency: number = Math.min(500, Math.max(1, (pluginConfig?.profileFrequency as number | undefined) ?? 10));
    const tokenBudget: number = Math.min(4000, Math.max(100, (pluginConfig?.tokenBudget as number | undefined) ?? 500));
    const hotContextEnabled: boolean = (pluginConfig?.hotContext as boolean | undefined) ?? true;
    const entityContextEnabled: boolean = (pluginConfig?.entityContext as boolean | undefined) ?? true;

    // ── Load hooks config ──
    const hooksConfig = loadHooksConfig(pluginConfig);

    // ── Backend init ──
    let sulcusMem: SulcusCloudClient | null = null;
    let backendMode = "unavailable";

    if (serverUrl && apiKey) {
      try {
        sulcusMem = new SulcusCloudClient(serverUrl, apiKey);
        backendMode = "cloud";
        logger.info(`sulcus: using cloud backend (server: ${serverUrl})`);
      } catch (e: unknown) {
        logger.warn(`sulcus: cloud client init failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    // Only attempt native/WASM fallback if cloud mode was NOT configured or failed.
    // When serverUrl+apiKey are set, the user intends cloud mode — don't warn about
    // missing native libs that they never intended to use.
    const nativeLoader = new NativeLibLoader(storeLibPath, vectorsLibPath);
    if (sulcusMem === null && !(serverUrl && apiKey)) {
      nativeLoader.init(logger);
      if (nativeLoader.loaded) {
        const wasmJsPath = resolve(wasmDir, "sulcus_wasm.js");
        if (existsSync(wasmJsPath)) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { SulcusMem, on_init } = require(wasmJsPath) as { SulcusMem: { create: (q: unknown, e: unknown) => SulcusCloudClient }; on_init?: () => void };
            if (typeof on_init === "function") on_init();
            sulcusMem = SulcusMem.create(nativeLoader.makeQueryFn(), nativeLoader.makeEmbedFn());
            backendMode = "wasm";
            logger.info(`sulcus: SulcusMem created via WASM (wasm: ${wasmJsPath})`);
          } catch (e: unknown) {
            logger.warn(`sulcus: WASM load failed: ${e instanceof Error ? e.message : e}`);
          }
        } else {
          logger.warn(`sulcus: WASM module not found at ${wasmJsPath}`);
        }
      } else {
        logger.info(`sulcus: local mode skipped — ${nativeLoader.error || "dylibs not found"}`);
      }
    }

    const isAvailable = sulcusMem !== null;
    const isCloudBackend = backendMode === "cloud" && sulcusMem instanceof SulcusCloudClient;

    // Update static awareness with runtime info
    STATIC_AWARENESS = buildStaticAwareness(backendMode, namespace);

    // ── Startup summary ──
    if (isAvailable) {
      logger.info(`sulcus: ready ✅ (backend: ${backendMode}, namespace: ${namespace}, autoRecall: ${autoRecall}, autoCapture: ${autoCapture})`);
    } else {
      // Give clear, actionable guidance instead of cryptic error chains
      const hints: string[] = [];
      if (!serverUrl && !apiKey) {
        hints.push("To use Sulcus cloud: set serverUrl and apiKey in plugin config");
        hints.push("Get an API key at https://sulcus.ca/dashboard/settings");
      } else if (serverUrl && !apiKey) {
        hints.push("serverUrl is set but apiKey is missing — add your API key to plugin config");
      } else if (!serverUrl && apiKey) {
        hints.push("apiKey is set but serverUrl is missing — add serverUrl (e.g. https://api.sulcus.ca)");
      } else {
        hints.push("Cloud connection failed — check serverUrl and apiKey are correct");
      }
      if (!serverUrl && !apiKey && nativeLoader.error) {
        hints.push(`Local mode: ${nativeLoader.error}`);
      }
      logger.warn(`sulcus: not ready — ${hints.join(". ")}`);
    }

    // ── SIU v2 request helper ──
    const siuRequestFn = isCloudBackend && sulcusMem
      ? (method: string, path: string, body?: unknown) => (sulcusMem as SulcusCloudClient).request(method, path, body)
      : null;

    // ── Shared deps ──
    const toolDeps: ToolDeps = {
      sulcusMem,
      backendMode,
      namespace,
      nativeLoader,
      storeLibPath,
      vectorsLibPath,
      wasmDir,
      logger,
      isAvailable,
      siuRequest: siuRequestFn,
    };

    const handlerCtx: HookHandlerCtx = {
      sulcusMem,
      backendMode,
      namespace,
      logger,
      nativeError: nativeLoader.error,
      storeLibPath,
      vectorsLibPath,
      wasmDir,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // SDK INTEGRATIONS (v4.0.0)
    // ─────────────────────────────────────────────────────────────────────────

    // 1. registerMemoryRuntime — Sulcus becomes the OpenClaw memory backend
    if (isCloudBackend && sulcusMem && typeof (api.registerMemoryRuntime as unknown) === "function") {
      try {
        (api.registerMemoryRuntime as (r: unknown) => void)(buildMemoryRuntime(sulcusMem as SulcusCloudClient, backendMode));
        logger.info("sulcus: registered as memory runtime (MemoryPluginRuntime)");
      } catch (e: unknown) {
        logger.warn(`sulcus: registerMemoryRuntime failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 2. registerMemoryPromptSection — dynamic system prompt guidance
    if (typeof (api.registerMemoryPromptSection as unknown) === "function") {
      try {
        (api.registerMemoryPromptSection as (b: unknown) => void)(buildPromptSection);
        logger.info("sulcus: registered memory prompt section");
      } catch (e: unknown) {
        logger.warn(`sulcus: registerMemoryPromptSection failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 3. registerMemoryFlushPlan — no custom compaction flush
    if (typeof (api.registerMemoryFlushPlan as unknown) === "function") {
      try {
        (api.registerMemoryFlushPlan as (r: unknown) => void)(() => null);
        logger.info("sulcus: registered memory flush plan (no-op)");
      } catch (e: unknown) {
        logger.warn(`sulcus: registerMemoryFlushPlan failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 4. registerService — lifecycle management
    if (typeof (api.registerService as unknown) === "function") {
      try {
        (api.registerService as (s: unknown) => void)({
          id: "openclaw-sulcus",
          start: async (ctx: Record<string, unknown>) => {
            const svcLogger = (ctx?.logger ?? logger) as PluginLogger;
            if (!isAvailable || !sulcusMem) {
              svcLogger.warn("sulcus: service start — backend unavailable, running in degraded mode");
              return;
            }
            if (isCloudBackend) {
              try {
                const ok = await (sulcusMem as SulcusCloudClient).probe();
                if (ok) svcLogger.info(`sulcus: service started — cloud backend connected (${serverUrl}, namespace: ${namespace})`);
                else svcLogger.warn(`sulcus: service started — cloud backend unreachable (${serverUrl})`);
              } catch (e
: unknown) {
                svcLogger.warn("sulcus: service start probe failed");
              }
            } else {
              svcLogger.info("sulcus: service started (backend: " + backendMode + ", namespace: " + namespace + ")");
            }
          },
          stop: async (ctx: Record<string, unknown>) => {
            const svcLogger = (ctx?.logger ?? logger) as PluginLogger;
            svcLogger.info("sulcus: service stopped");
          },
        });
        logger.info("sulcus: registered service lifecycle");
      } catch (e: unknown) {
        logger.warn("sulcus: registerService failed: " + (e instanceof Error ? e.message : String(e)));
      }
    }

    // 5. before_prompt_build — recall + awareness (SDK path, v5.0.0+)
    //    When autoRecall=true and cloud backend available: recall + inject awareness via prependContext.
    //    When autoRecall=false but cloud backend available: inject awareness only (static context block).
    //    Replaces legacy before_agent_start for new work; legacy hook loop handles fallback.
    if (isCloudBackend && sulcusMem) {
      if (autoRecall) {
        const sdkRecallHandler = buildSdkRecallHandler(
          sulcusMem as SulcusCloudClient,
          namespace,
          maxRecallResults,
          profileFrequency,
          logger,
          tokenBudget,
          hotContextEnabled,
          entityContextEnabled
        );
        const apiOn = api.on as (event: string, handler: unknown) => void;
        apiOn("before_prompt_build", async (event: Record<string, unknown>, ctx: unknown) => {
          try {
            // Recall returns prependContext with memories + awareness embedded
            const result = await sdkRecallHandler(event, ctx);
            // If recall returned nothing (no prompt), fall back to awareness-only
            if (!result) return { prependSystemContext: STATIC_AWARENESS };
            // Translate prependContext → prependSystemContext for hook shape compat
            const r = result as { prependContext?: string; prependSystemContext?: string };
            if (r.prependContext) return { prependSystemContext: r.prependContext };
            return result;
          } catch (err) {
            logger.warn("sulcus: before_prompt_build recall hook threw: " + err);
            return { prependSystemContext: STATIC_AWARENESS };
          }
        });
        logger.info("sulcus: registered before_prompt_build (recall + awareness)");
      } else {
        // Awareness-only path — inject static context without recall
        const apiOn = api.on as (event: string, handler: unknown) => void;
        apiOn("before_prompt_build", async (_event: Record<string, unknown>, _ctx: unknown) => {
          return { prependSystemContext: STATIC_AWARENESS };
        });
        logger.info("sulcus: registered before_prompt_build (awareness-only)");
      }
    }

    // 6. registerMemoryEmbeddingProvider — Sulcus embedding adapter
    if (typeof (api.registerMemoryEmbeddingProvider as unknown) === "function" && isCloudBackend && sulcusMem) {
      try {
        (api.registerMemoryEmbeddingProvider as (adapter: unknown) => void)({
          id: "sulcus",
          label: "Sulcus (BGE-small-en-v1.5)",
          transport: "remote",
          autoSelectPriority: 50,
          embed: async (texts: string[]) => {
            // Route through Sulcus cloud API for embeddings
            let warned = false;
            const results = await Promise.all(
              texts.map(async (text) => {
                const res = await (sulcusMem as SulcusCloudClient).embed_text(text, namespace);
                if (!res) {
                  if (!warned) {
                    warned = true;
                    logger.warn("sulcus: embed_text returned null — /api/v1/agent/embed not available on this server version; embedding provider will return empty vectors");
                  }
                  return [];
                }
                return res.embedding;
              })
            );
            return { embeddings: results, model: "bge-small-en-v1.5", dimensions: 384 };
          },
        });
        logger.info("sulcus: registered memory embedding provider (BGE-small-en-v1.5)");
      } catch (e: unknown) {
        logger.warn(`sulcus: registerMemoryEmbeddingProvider failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 7. auto-capture on agent_end
    if (autoCapture) {
      const agentEndCaptureConfig: HookConfig = {
        action: "sivu_auto_capture",
        enabled: true,
        min_store_confidence: 0.5,
        fallback_on_error: true,
      };
      const apiOn = api.on as (event: string, handler: unknown) => void;
      apiOn("agent_end", async (event: Record<string, unknown>, _ctx: unknown) => {
        try {
          return await hookHandlers.sivu_auto_capture(event, agentEndCaptureConfig, handlerCtx);
        } catch (err) {
          logger.warn("sulcus: auto-capture hook threw: " + err);
          return undefined;
        }
      });
      logger.info("sulcus: registered auto-capture (agent_end)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LEGACY HOOK REGISTRATION (config-driven, backward compat)
    // ─────────────────────────────────────────────────────────────────────────

    for (const [hookName, hookConfig] of Object.entries(hooksConfig.hooks)) {
      if (!hookConfig.enabled) continue;

      // Skip before_agent_start if we already registered the SDK path (v5: SDK uses before_prompt_build)
      if (hookName === "before_agent_start" && autoRecall && isCloudBackend) continue;
      // Skip before_prompt_build if we already registered the SDK handler above
      if (hookName === "before_prompt_build" && isCloudBackend && sulcusMem) continue;
      // Skip agent_end if autoCapture SDK path already registered
      if (hookName === "agent_end" && autoCapture && hookConfig.action === "sivu_auto_capture") continue;

      const handler = hookHandlers[hookConfig.action];
      if (handler) {
        const apiOn = api.on as (event: string, handler: unknown) => void;
        apiOn(hookName, async (event: Record<string, unknown>) => {
          try {
            return await handler(event, hookConfig, handlerCtx);
          } catch (err) {
            logger.warn("sulcus: hook " + hookName + " (action=" + hookConfig.action + ") threw: " + err);
            return undefined;
          }
        });
      } else {
        logger.warn("sulcus: unknown hook action " + hookConfig.action + " for hook " + hookName);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TOOL REGISTRATION
    // ─────────────────────────────────────────────────────────────────────────

    for (const [toolName, toolConfig] of Object.entries(hooksConfig.tools)) {
      if (!toolConfig.enabled) continue;
      const toolDef = toolDefinitions[toolName];
      if (toolDef) {
        const schema = {
          ...toolDef.schema,
          async execute(id: string, params: Record<string, unknown>) {
            return toolDef.makeExecute(toolDeps)(id, params);
          },
        };
        const registerTool = api.registerTool as (schema: unknown, opts: unknown) => void;
        registerTool(schema, toolDef.options);
      } else {
        logger.warn("sulcus: unknown tool " + toolName + " in config — skipping");
      }
    }

    // First-install history import (opt-in via config.importHistory: true)
    // Reads OpenClaw workspace files (MEMORY.md, daily notes) and stores them as
    // episodic memories. Only runs once (writes a marker file). Disabled by default
    // to prevent unexpected data ingestion — especially important in cloud mode.
    if (isAvailable && sulcusMem instanceof SulcusCloudClient && pluginConfig?.importHistory === true) {
      importOpenClawHistory(sulcusMem, logger).catch((e: unknown) => {
        logger.warn(`sulcus: history import failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    }
  }
};

export default sulcusPlugin;
