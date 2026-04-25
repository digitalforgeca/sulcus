import { resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";
import { Type } from "@sinclair/typebox";

// ─── STATIC AWARENESS ───────────────────────────────────────────────────────
// Task 12: XML-structured injection — static awareness uses the same
// <sulcus_context> envelope as the dynamic recall path for LLM consistency.

function buildStaticAwareness(backendMode: string, namespace: string): string {
  return `<sulcus_context backend="${backendMode}" namespace="${namespace}">
  <guidance>You have Sulcus — persistent, thermodynamic memory. Memories survive across sessions with heat (0.0–1.0) that decays over time. Use memory tools proactively.</guidance>
  <cheatsheet>
    <tool name="memory_store" params="content, memory_type">
      Save preferences, decisions, lessons, corrections, facts. Trigger: user states anything worth remembering.
      Types: episodic (events, fast decay) | semantic (knowledge, slow) | preference (opinions, slower) | procedural (how-tos, slowest) | fact (data, slow)
    </tool>
    <tool name="memory_recall" params="query, limit">
      Search prior work, decisions, people, context. Trigger: incomplete context, past-reference questions.
    </tool>
  </cheatsheet>
</sulcus_context>`;
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
  boostOnRecall?: boolean;
}

interface PluginLogger {
  debug?: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

type HookHandler = (event: Record<string, unknown>, config: HookConfig, ctx: HookHandlerCtx) => Promise<unknown>;

// ─── HOOK RECALL CACHE (Task 14 parity for hook path) ──────────────────────
// Per-namespace topic-shift cache for the auto_recall hook.
// Mirrors the SDK recall handler cache so hooks avoid redundant API calls
// when the conversation topic is stable across consecutive turns.

interface HookRecallCache {
  results: Record<string, unknown>[];
  topicTokens: Set<string>;
  cachedAt: number;
}

const hookRecallCacheMap = new Map<string, HookRecallCache>();
const HOOK_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const HOOK_TOPIC_SHIFT_THRESHOLD = 0.25;  // Jaccard overlap below this = topic shift

// ─── HOOK HANDLERS ───────────────────────────────────────────────────────────

const hookHandlers: Record<string, HookHandler> = {
  inject_awareness: async (_event, _config, _ctx) => {
    return { appendSystemContext: STATIC_AWARENESS };
  },

  auto_recall: async (event, config, ctx) => {
    // Task 22: Unified recall pipeline — same XML formatting, budget enforcement,
    // diversity filter, and conflict surfacing as the SDK recall path.
    // Task 14 parity: topic-shift detection + per-namespace cache for hook path.
    const { sulcusMem, namespace, logger } = ctx;
    if (!sulcusMem) return;
    const agentLabel = (event?.agentId as string) ?? "(unknown)";
    logger.info(`sulcus: auto_recall hook triggered for agent ${agentLabel}`);
    const rawPrompt = typeof event?.prompt === "string" ? event.prompt : "";
    if (!rawPrompt) return;
    // Strip OpenClaw metadata noise before using as search query
    const prompt = sanitizeRecallQuery(rawPrompt);
    if (!prompt || prompt.length < 3) return;
    try {
      const limit = (config.limit as number) ?? 5;

      // ── Topic-shift detection (Task 14 parity) ────────────────────────────
      const cacheKey = namespace;
      const currentTokens = extractTopicTokens(prompt);
      const existingCache = hookRecallCacheMap.get(cacheKey);
      const cacheExpired = existingCache !== undefined && (Date.now() - existingCache.cachedAt) > HOOK_CACHE_TTL_MS;
      const overlap = existingCache !== undefined ? topicOverlap(currentTokens, existingCache.topicTokens) : 0;
      const topicShifted = existingCache === undefined || cacheExpired || overlap < HOOK_TOPIC_SHIFT_THRESHOLD;

      let vectorResults: Record<string, unknown>[];
      if (!topicShifted && existingCache !== undefined) {
        vectorResults = existingCache.results;
        logger.info(`sulcus: auto_recall hook — topic stable (overlap=${overlap.toFixed(2)}), serving cached recall`);
      } else {
        if (existingCache !== undefined) {
          logger.info(`sulcus: auto_recall hook — TOPIC SHIFT detected (overlap=${overlap.toFixed(2)}), fresh recall`);
        }
        logger.debug?.(`sulcus: searching context for prompt: ${prompt.substring(0, 50)}... (namespace: ${namespace})`);
        const res = await sulcusMem.search_memory(prompt, limit, namespace);
        vectorResults = res?.results ?? [];
        // Update cache with fresh results
        hookRecallCacheMap.set(cacheKey, { results: vectorResults, topicTokens: currentTokens, cachedAt: Date.now() });
      }
      // ── end topic-shift detection ─────────────────────────────────────────
      if (!vectorResults || vectorResults.length === 0) {
        return { prependSystemContext: FALLBACK_AWARENESS };
      }

      // ── Graph-hop expansion (Task 13) — parity with SDK recall path ──────
      // Seed from top-2 vector hits, fetch AGE neighbours, fold in warm nodes.
      let rawResults = vectorResults;
      if (sulcusMem instanceof SulcusCloudClient) {
        const seedIds = vectorResults.slice(0, 2).map((r) => r.id as string).filter(Boolean);
        if (seedIds.length > 0) {
          try {
            const neighborFetches = await Promise.allSettled(
              seedIds.map((id) => (sulcusMem as SulcusCloudClient).graph_neighbors(id, 6))
            );
            const seenIds = new Set(vectorResults.map((r) => r.id as string));
            const graphExtras: Record<string, unknown>[] = [];
            for (const result of neighborFetches) {
              if (result.status !== "fulfilled") continue;
              for (const node of result.value) {
                const nodeId = node.id as string;
                if (!nodeId || seenIds.has(nodeId)) continue;
                const heat = (node.current_heat as number) ?? 0;
                if (heat < 0.2) continue; // skip cold ephemeral noise
                seenIds.add(nodeId);
                graphExtras.push({ ...node, _source: "graph" });
              }
            }
            if (graphExtras.length > 0) {
              graphExtras.sort((a, b) => ((b.current_heat as number) ?? 0) - ((a.current_heat as number) ?? 0));
              rawResults = [...vectorResults, ...graphExtras.slice(0, 4)];
              logger.info(`sulcus: auto_recall graph-hop added ${Math.min(graphExtras.length, 4)} neighbour(s)`);
            }
          } catch {
            // graph expansion failed — fall back to vector results only
          }
        }
      }
      // ── end graph-hop ─────────────────────────────────────────────────────

      // ── Budget constants (mirror SDK recall) ──────────────────────────────
      const TOKEN_BUDGET = 500;
      const FIXED_OVERHEAD = 80;

      // ── Diversity filter (Task 20) ─────────────────────────────────────────
      const preDiversity = rawResults.map((r) => ({
        ...r,
        label: ((r.label ?? r.pointer_summary ?? r.id ?? "") as string),
        _heat: (r.current_heat as number) ?? (r.score as number) ?? 0,
      }));
      preDiversity.sort((a, b) => b._heat - a._heat);
      const diverseResults = diversityFilter(preDiversity, limit);
      const droppedCount = preDiversity.length - diverseResults.length;
      if (droppedCount > 0) logger.info(`sulcus: auto_recall diversity filter dropped ${droppedCount} near-duplicate(s)`);

      // ── XML-escape labels ─────────────────────────────────────────────────
      const escapedResults = diverseResults.map((r) => ({
        ...r,
        label: r.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      }));

      // ── Budget enforcement (Task 18) ──────────────────────────────────────
      const budgeted = enforceContextBudget(escapedResults, TOKEN_BUDGET, FIXED_OVERHEAD);

      // ── Structured grouped recall (Task 12 + Task 13 source tag) ─────────
      const heatToRelevance = (h: number): string => h >= 0.6 ? "high" : h >= 0.35 ? "medium" : "low";
      const typeOrder = ["procedural", "semantic", "fact", "episodic", "preference"];
      const grouped = new Map<string, string[]>();
      for (const r of budgeted) {
        const heat = r._heat as number;
        const heatStr = heat.toFixed(2);
        const mtype = (r.memory_type as string) ?? "episodic";
        const updatedAt = r.updated_at as string | undefined;
        const ageStr = updatedAt ? formatRelativeTime(updatedAt) : "unknown";
        const source = (r._source as string) === "graph" ? "graph" : "vector";
        const relevance = heatToRelevance(heat);
        const el = `    <memory heat="${heatStr}" age="${ageStr}" source="${source}" relevance="${relevance}">${r.label}</memory>`;
        if (!grouped.has(mtype)) grouped.set(mtype, []);
        grouped.get(mtype)!.push(el);
      }
      const seenTypes = new Set(grouped.keys());
      const recallBlocks: string[] = [];
      for (const t of [...typeOrder, ...Array.from(seenTypes).filter((t) => !typeOrder.includes(t))]) {
        const els = grouped.get(t);
        if (!els || els.length === 0) continue;
        recallBlocks.push(`  <group type="${t}" count="${els.length}">\n${els.join("\n")}\n  </group>`);
      }

      // ── Conflict surfacing (Task 19) ───────────────────────────────────────
      const conflictCandidates = diverseResults.map((r) => ({
        ...r,
        label: r.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
        updated_at: r.updated_at as string | undefined,
      }));
      const conflictPairs = detectConflicts(conflictCandidates);

      // ── Assemble context XML ──────────────────────────────────────────────
      const sections: string[] = [];
      if (recallBlocks.length > 0) sections.push(`<recall>\n${recallBlocks.join("\n")}\n</recall>`);
      if (conflictPairs.length > 0) {
        const conflictEls = conflictPairs.map((p) => {
          const reasonNote = p.reason === "negation"
            ? "one memory appears to correct or negate the other"
            : "similar topic but memories are from very different times";
          return `  <conflict reason="${p.reason}" note="${reasonNote}">\n    <older>${p.olderLabel}</older>\n    <newer>${p.newerLabel}</newer>\n  </conflict>`;
        });
        sections.push(`<conflicts note="Potentially contradictory memories — trust newer/corrective entries">\n${conflictEls.join("\n")}\n</conflicts>`);
        logger.info(`sulcus: auto_recall conflict surfacing found ${conflictPairs.length} pair(s)`);
      }

      if (sections.length === 0) return { prependSystemContext: FALLBACK_AWARENESS };

      const guidance = "Background context from long-term memory. Use it silently to inform your understanding — only surface it when the conversation naturally calls for it.";
      const contextParts = [
        `<guidance>${guidance}</guidance>`,
        ...sections,
      ];
      const context = `<sulcus_context token_budget="${TOKEN_BUDGET}" namespace="${namespace}">\n${contextParts.join("\n")}\n</sulcus_context>`;
      const estimatedTokens = estimateTokens(context);
      logger.info(`sulcus: auto_recall injecting context (${context.length} chars, ~${estimatedTokens}/${TOKEN_BUDGET} tokens, recall: ${budgeted.length})`);

      // Spaced repetition: boost heat for recalled memories (fire-and-forget)
      if (ctx.boostOnRecall !== false && sulcusMem instanceof SulcusCloudClient) {
        boostRecalledMemories(sulcusMem, budgeted, logger).catch(() => {});
      }

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

        const hints = buildExtractionHints(memoryType, ctx.namespace, "user_capture", userMessage.substring(0, 200));
        const res = await sulcusMem.add_memory(userMessage, memoryType, hints);
        const typeConf = ((siuResult?.type_confidence as number) ?? 0).toFixed(3);
        logger.info(`sulcus: sivu_auto_capture — stored [${memoryType}] (id: ${res?.id ?? "?"}, sivu_conf: ${storeConf.toFixed(3)}, sicu_conf: ${typeConf}, model: ${modelVersion}, hints: ${hints ? "yes" : "no"}): "${userMessage.substring(0, 60)}..."`);

        // ── Task 21: Correction detection (SIVU path) ───────────────────────
        if (isCorrectionMessage(userMessage)) {
          const boosted = await boostRelatedMemories(sulcusMem, userMessage, ctx.namespace, 0.85, 3, logger);
          if (boosted > 0) {
            logger.info(`sulcus: sivu_auto_capture — correction detected, heat-boosted ${boosted} related memor${boosted === 1 ? "y" : "ies"}`);
          }
        }
        return;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`sulcus: sivu_auto_capture — SIU v2 endpoint error: ${msg}`);
        if (!fallbackOnError) return;
      }
    }

    try {
      const fallbackHints = buildExtractionHints("episodic", ctx.namespace, "user_capture", userMessage.substring(0, 200));
      const res = await sulcusMem.add_memory(userMessage, "episodic", fallbackHints);
      logger.info(`sulcus: sivu_auto_capture — fallback stored [episodic] (id: ${res?.id ?? "?"}): "${userMessage.substring(0, 60)}..."`);

      // ── Task 21: Correction detection (fallback path) ───────────────────
      if (isCorrectionMessage(userMessage) && sulcusMem instanceof SulcusCloudClient) {
        const boosted = await boostRelatedMemories(sulcusMem, userMessage, ctx.namespace, 0.85, 3, logger);
        if (boosted > 0) {
          logger.info(`sulcus: sivu_auto_capture — correction detected, heat-boosted ${boosted} related memor${boosted === 1 ? "y" : "ies"}`);
        }
      }
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
      const errorHints = buildExtractionHints("episodic", ctx.namespace, "tool_error", memoryContent.substring(0, 200));
      const res = await sulcusMem.add_memory(memoryContent, "episodic", errorHints);
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
      const compactionHints = buildExtractionHints("episodic", ctx.namespace, "compaction", summary.substring(0, 200));
      const res = await sulcusMem.add_memory(summary, "episodic", compactionHints);
      logger.info(`sulcus: pre_compaction_capture — stored session summary (id: ${res?.id ?? "?"}, hints: ${compactionHints ? "yes" : "no"})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.debug?.(`sulcus: pre_compaction_capture — store failed: ${msg}`);
    }
  },
};

// ─── EXTRACTION HINTS ───────────────────────────────────────────────────────

/**
 * Caller-supplied hints for SILU entity extraction + classification.
 * Mirrors the server-side ExtractionHints struct (entity_extraction.rs).
 * These are injected as a preamble into the SILU system prompt to guide
 * extraction without overriding the LLM's judgment.
 */
export interface ExtractionHints {
  /** Entity types the caller expects (e.g. ["person", "tool", "project"]). */
  entity_types?: string[];
  /** Free-form domain focus areas (e.g. ["infrastructure", "memory systems"]). */
  focus_areas?: string[];
  /** Entity types to suppress if irrelevant (e.g. ["location"]). */
  suppress_types?: string[];
  /** Soft suggestion for memory type — SILU may override if content clearly differs. */
  expected_type?: string;
  /** Free-form context note injected verbatim (max 500 chars server-side). */
  context_note?: string;
}

/**
 * Derive ExtractionHints from available context signals.
 * Called at store time to guide SILU toward better entity extraction + classification.
 *
 * @param memoryType  - The memory type being stored (episodic|semantic|etc.)
 * @param namespace   - Agent namespace (provides domain context)
 * @param eventType   - Hook event type (e.g. "sivu_auto_capture", "tool_error", "compaction")
 * @param contentSnippet - First 200 chars of content for heuristic detection
 */
function buildExtractionHints(
  memoryType: string | null | undefined,
  namespace: string,
  eventType: string,
  contentSnippet: string
): ExtractionHints | undefined {
  const hints: ExtractionHints = {};

  // ── Expected type from known memory_type ──
  if (memoryType && memoryType !== "episodic") {
    hints.expected_type = memoryType;
  }

  // ── Domain focus from namespace ──
  // Namespace is typically the agent id — map known agents to domains
  const ns = namespace.toLowerCase();
  if (ns.includes("sulcus") || ns.includes("memory")) {
    hints.focus_areas = ["memory systems", "AI infrastructure", "sulcus"];
    hints.entity_types = ["tool", "concept", "project", "model"];
  } else if (ns.includes("daedalus") || ns.includes("forge") || ns.includes("workshop")) {
    hints.focus_areas = ["infrastructure", "devops", "software engineering", "AI agents"];
    hints.entity_types = ["tool", "project", "person", "organization"];
  } else if (ns.includes("icarus") || ns.includes("booker")) {
    hints.focus_areas = ["product development", "business logic"];
    hints.entity_types = ["tool", "project", "person"];
  }

  // ── Event-type signals ──
  if (eventType === "tool_error") {
    hints.context_note = "This is a tool failure memory — focus on tool names, error patterns, and failure causes.";
    hints.entity_types = [...(hints.entity_types ?? []), "tool"];
    hints.suppress_types = ["location"];
  } else if (eventType === "compaction") {
    hints.context_note = "This is a session summary from context compaction — extract key decisions, files modified, and tasks completed.";
    hints.entity_types = [...(hints.entity_types ?? []), "project", "tool"];
  } else if (eventType === "user_capture") {
    // User conversational content — don't over-suppress anything
    if (!hints.context_note) {
      hints.context_note = "This was captured from a user message during an agent session.";
    }
  }

  // ── Content heuristics ──
  const lower = contentSnippet.toLowerCase();
  if (lower.includes("prefer") || lower.includes("always") || lower.includes("never") || lower.includes("want")) {
    if (!hints.expected_type) hints.expected_type = "preference";
  } else if (lower.includes("step") || lower.includes("command") || lower.includes("run ") || lower.includes("deploy")) {
    if (!hints.expected_type) hints.expected_type = "procedural";
  } else if (lower.includes("is defined as") || lower.includes("means") || lower.includes("concept") || lower.includes("architecture")) {
    if (!hints.expected_type) hints.expected_type = "semantic";
  }

  // Return undefined if nothing useful was derived (avoid sending empty hints)
  const hasContent =
    (hints.entity_types?.length ?? 0) > 0 ||
    (hints.focus_areas?.length ?? 0) > 0 ||
    (hints.suppress_types?.length ?? 0) > 0 ||
    hints.expected_type != null ||
    hints.context_note != null;

  return hasContent ? hints : undefined;
}

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

  async add_memory(content: string, memoryType?: string | null, hints?: ExtractionHints): Promise<{ id: string; [key: string]: unknown }> {
    const body: Record<string, unknown> = { label: content };
    if (memoryType) body.memory_type = memoryType;
    // Phase 2: SILU prompt injection — pass extraction hints to guide entity extraction + classification
    if (hints) body.extraction_hints = hints;
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

  async get_memory(id: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await this.request("GET", `/api/v1/agent/nodes/${encodeURIComponent(id)}`) as Record<string, unknown> | null;
      return res;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("404")) return null;
      throw e;
    }
  }

  async list_memories(opts: { page?: number; page_size?: number; memory_type?: string; namespace?: string; pinned?: boolean; sort_by?: string; sort_order?: string } = {}): Promise<{ items: Record<string, unknown>[]; total?: number; page?: number; page_size?: number }> {
    const params = new URLSearchParams();
    if (opts.page !== undefined) params.set("page", String(opts.page));
    if (opts.page_size !== undefined) params.set("page_size", String(opts.page_size));
    if (opts.memory_type) params.set("memory_type", opts.memory_type);
    if (opts.namespace) params.set("namespace", opts.namespace);
    if (opts.pinned !== undefined) params.set("pinned", String(opts.pinned));
    if (opts.sort_by) params.set("sort_by", opts.sort_by);
    if (opts.sort_order) params.set("sort_order", opts.sort_order);
    const q = params.toString() ? `?${params.toString()}` : "";
    const res = await this.request("GET", `/api/v1/agent/nodes${q}`) as Record<string, unknown> | unknown[] | null;
    if (Array.isArray(res)) return { items: res as Record<string, unknown>[], total: res.length };
    const r = (res ?? {}) as Record<string, unknown>;
    const items = (r.items ?? r.nodes ?? r.results ?? []) as Record<string, unknown>[];
    return { items, total: r.total as number | undefined, page: r.page as number | undefined, page_size: r.page_size as number | undefined };
  }

  async update_memory(id: string, updates: { content?: string; label?: string; memory_type?: string; is_pinned?: boolean; current_heat?: number }): Promise<Record<string, unknown> | null> {
    const res = await this.request("PATCH", `/api/v1/agent/memory/${encodeURIComponent(id)}`, updates) as Record<string, unknown> | null;
    return res;
  }

  async probe(): Promise<boolean> {
    try {
      await this.search_memory("probe", 1);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch graph neighbours for a memory node via AGE Cypher.
   * Returns [] gracefully if the endpoint is unavailable (server too old).
   */
  async graph_neighbors(nodeId: string, limit = 6): Promise<Record<string, unknown>[]> {
    try {
      const res = await this.request("GET", `/api/v1/agent/graph/neighbors/${encodeURIComponent(nodeId)}?limit=${limit}`) as Record<string, unknown> | null;
      if (!res) return [];
      const nodes = (res.neighbors ?? res.nodes ?? res.results ?? (Array.isArray(res) ? res : [])) as Record<string, unknown>[];
      return nodes;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // 404 = server too old, no graph endpoint — degrade gracefully
      if (msg.includes("404") || msg.includes("HTTP 404")) return [];
      return [];
    }
  }

  /**
   * Task 23: SIRU recall logging — post a recall session to the server for training data.
   * Fire-and-forget: called after each fresh recall, never blocks context injection.
   * Server stores this in recall_sessions table for SIRU adaptive scoring.
   */
  async recall_log(payload: {
    namespace: string;
    agent_id: string;
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
    try {
      await this.request("POST", "/api/v1/agent/recall-log", payload);
    } catch {
      // Logging failure must never interrupt recall — silently drop
    }
  }
}

// ─── NATIVE LIB LOADER ──────────────────────────────────────────────────────

class NativeLibLoader {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private koffi: unknown = null;
  private storeLib: unknown = null;
  private vectorsLib: unknown = null;
  private vectorsHandle: unknown = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private fn_store_init: any = null;
  private fn_store_query: any = null;
  private fn_store_free: any = null;
  private fn_vectors_create: any = null;
  private fn_vectors_text: any = null;
  private fn_vectors_free: any = null;

  public loaded = false;
  public error: string | null = null;

  constructor(private storeLibPath: string, private vectorsLibPath: string) {}

  init(logger: PluginLogger): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.koffi = require("koffi");
    } catch (e: unknown) {
      this.error = `koffi not available: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }

    if (!existsSync(this.storeLibPath)) {
      this.error = `libsulcus_store not found at ${this.storeLibPath}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }
    if (!existsSync(this.vectorsLibPath)) {
      this.error = `libsulcus_vectors not found at ${this.vectorsLibPath}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }

    try {
      const k = this.koffi as any;
      this.storeLib = k.load(this.storeLibPath);
      this.fn_store_init  = (this.storeLib as any).func("sulcus_store_init", "int", ["str", "uint16"]);
      this.fn_store_query = (this.storeLib as any).func("sulcus_store_query", "char*", ["str"]);
      this.fn_store_free  = (this.storeLib as any).func("sulcus_store_free_string", "void", ["char*"]);
    } catch (e: unknown) {
      this.error = `Failed to load libsulcus_store: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }

    try {
      const k = this.koffi as any;
      this.vectorsLib = k.load(this.vectorsLibPath);
      this.fn_vectors_create = (this.vectorsLib as any).func("sulcus_vectors_create", "void*", []);
      this.fn_vectors_text   = (this.vectorsLib as any).func("sulcus_vectors_text",   "char*", ["void*", "str"]);
      this.fn_vectors_free   = (this.vectorsLib as any).func("sulcus_vectors_free_string", "void", ["char*"]);
    } catch (e: unknown) {
      this.error = `Failed to load libsulcus_vectors: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }

    try {
      const dataDir = resolve(process.env.HOME || "~", ".sulcus/data");
      const rc = this.fn_store_init(dataDir, 15432);
      if (rc !== 0) {
        this.error = `sulcus_store_init returned ${rc}`;
        logger.warn(`sulcus: ${this.error}`);
        return;
      }
    } catch (e: unknown) {
      this.error = `sulcus_store_init failed: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }

    try {
      this.vectorsHandle = this.fn_vectors_create();
    } catch (e: unknown) {
      this.error = `sulcus_vectors_create failed: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }

    this.loaded = true;
    logger.info(`sulcus: native libs loaded (store: ${this.storeLibPath}, vectors: ${this.vectorsLibPath})`);
  }

  makeQueryFn(): (sql: string, params: unknown[]) => Promise<unknown[]> {
    return async (sql: string, params: unknown[]): Promise<unknown[]> => {
      if (!this.loaded) throw new Error("Sulcus store not available");
      const raw: string = this.fn_store_query(JSON.stringify({ sql, params }));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const p = parsed as Record<string, unknown>;
      return Array.isArray(parsed) ? (parsed as unknown[]) : ((Array.isArray(p?.rows) ? p.rows as unknown[] : [parsed as unknown]));
    };
  }

  makeEmbedFn(): (text: string) => Promise<Float32Array> {
    return async (text: string): Promise<Float32Array> => {
      if (!this.loaded) throw new Error("Sulcus vectors not available");
      const raw: string = this.fn_vectors_text(this.vectorsHandle, text);
      if (!raw) throw new Error("sulcus_vectors_text returned null");
      const arr: number[] = JSON.parse(raw);
      return new Float32Array(arr);
    };
  }
}

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
  // Match raw function-call blobs only — NOT prose that mentions tool/function concepts.
  // e.g. raw JSON {"tool_calls":[...]} or <function_calls><invoke> XML sequences.
  // Avoids false-positives on architectural content like "the tool call returns..."
  /^\{"tool_calls":/i,
  /^<function_calls>\s*<invoke/i,
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

// ─── HOOKS CONFIG LOADER ─────────────────────────────────────────────────────

function loadHooksConfig(apiConfig: Record<string, unknown>): HooksConfig {
  const defaultsPath = resolve(__dirname, "hooks.defaults.json");
  let defaults: HooksConfig;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    defaults = JSON.parse(require("fs").readFileSync(defaultsPath, "utf-8")) as HooksConfig;
  } catch (_e) {
    defaults = {
      version: 1,
      hooks: {
        before_prompt_build: { action: "inject_awareness", enabled: true },
        before_agent_start: { action: "auto_recall", enabled: false, limit: 5, minScore: 0.3 },
        agent_end: { action: "none", enabled: true },
        after_tool_call: { action: "auto_error_capture", enabled: true },
        before_compaction: { action: "pre_compaction_capture", enabled: true },
      },
      tools: {
        memory_recall: { enabled: true },
        memory_store: { enabled: true },
        memory_status: { enabled: true },
        memory_profile: { enabled: true },
        consolidate: { enabled: false },
        export_markdown: { enabled: false },
        import_markdown: { enabled: false },
        evaluate_triggers: { enabled: false },
        __sulcus_workflow__: { enabled: true },
      },
    };
  }

  const userHooks = (apiConfig?.hooks ?? {}) as Record<string, Partial<HookConfig>>;
  const userTools = (apiConfig?.tools ?? {}) as Record<string, Partial<ToolConfig>>;

  const mergedHooks: Record<string, HookConfig> = { ...defaults.hooks };
  for (const [name, override] of Object.entries(userHooks)) {
    mergedHooks[name] = { ...(mergedHooks[name] ?? { action: "none", enabled: false }), ...override };
  }

  const mergedTools: Record<string, ToolConfig> = { ...defaults.tools };
  for (const [name, override] of Object.entries(userTools)) {
    mergedTools[name] = { ...(mergedTools[name] ?? { enabled: false }), ...override };
  }

  // Legacy compat: autoRecall flag → hooks.before_prompt_build.enabled (v5.0.0+)
  // Also keeps before_agent_start enabled for backward compat with older configs.
  if (apiConfig?.autoRecall === true) {
    mergedHooks["before_prompt_build"] = {
      ...(mergedHooks["before_prompt_build"] ?? { action: "auto_recall", enabled: false }),
      enabled: true,
    };
    mergedHooks["before_agent_start"] = {
      ...(mergedHooks["before_agent_start"] ?? { action: "auto_recall", enabled: false }),
      enabled: true,
    };
  }

  return { version: defaults.version, hooks: mergedHooks, tools: mergedTools };
}

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

// ─── CORRECTION DETECTION + HEAT-BOOST (Task 21) ──────────────────────────────────

/**
 * Markers that strongly suggest the user is correcting or updating a prior belief.
 * Checked against the full message text (case-insensitive).
 */
const CORRECTION_MARKERS: string[] = [
  "actually,", "actually ", "that's wrong", "thats wrong",
  "that is wrong", "correction:", "no, it", "no it's", "not quite",
  "update:", "i meant", "i mean", "i was wrong", "was incorrect",
  "is incorrect", "please update", "forget that", "ignore that",
  "disregard", "instead,", "rather,", "not that,", "fix:",
];

function isCorrectionMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return CORRECTION_MARKERS.some((m) => lower.includes(m));
}

/**
 * Heat-boost memories semantically related to a correction message.
 * Searches for up to `limit` related memories and PATCHes each with
 * elevated heat so they surface strongly and decay slowly.
 * Best-effort — individual PATCH failures are silently skipped.
 */
async function boostRelatedMemories(
  sulcusMem: SulcusCloudClient,
  query: string,
  namespace: string,
  boostHeat: number,
  limit: number,
  logger: PluginLogger,
): Promise<number> {
  let boosted = 0;
  try {
    const res = await sulcusMem.search_memory(query, limit, namespace);
    const results = res?.results ?? [];
    await Promise.allSettled(
      results.map(async (node) => {
        const nodeId = node.id as string;
        if (!nodeId) return;
        try {
          await sulcusMem.request("PATCH", `/api/v1/agent/memory/${nodeId}`, { current_heat: boostHeat });
          boosted++;
        } catch {
          // best-effort
        }
      })
    );
  } catch {
    // search failed — no boost possible
  }
  return boosted;
}

// ─── SPACED REPETITION: BOOST ON RECALL ─────────────────────────────────────────

/**
 * Spaced-repetition heat boost for recalled memories.
 * When a memory surfaces in context, nudge its heat upward so frequently
 * accessed knowledge persists longer. Caps at 0.95 to avoid pinning memories
 * that should eventually decay.
 *
 * Boost is small (delta 0.05–0.10) so the thermodynamic decay still governs
 * long-term retention — this just resets the decay clock slightly.
 * Best-effort — PATCH failures are silently swallowed.
 */
async function boostRecalledMemories(
  sulcusMem: SulcusCloudClient,
  memories: Array<{ id?: unknown; current_heat?: unknown }>,
  logger: PluginLogger,
): Promise<void> {
  const BOOST_DELTA = 0.08;
  const BOOST_CAP = 0.95;
  const MIN_HEAT_FOR_BOOST = 0.1; // don't boost nearly-dead memories

  const toBoost = memories
    .map((m) => ({ id: m.id as string | undefined, heat: (m.current_heat as number) ?? 0 }))
    .filter((m) => m.id && m.heat >= MIN_HEAT_FOR_BOOST);

  if (toBoost.length === 0) return;

  let boosted = 0;
  await Promise.allSettled(
    toBoost.map(async ({ id, heat }) => {
      const newHeat = Math.min(BOOST_CAP, heat + BOOST_DELTA);
      try {
        await sulcusMem.request("PATCH", `/api/v1/agent/memory/${encodeURIComponent(id!)}`, {
          current_heat: parseFloat(newHeat.toFixed(3)),
        });
        boosted++;
      } catch {
        // best-effort — server may be busy or node already decayed
      }
    })
  );

  if (boosted > 0) {
    logger.info(`sulcus: boost-on-recall — nudged heat for ${boosted}/${toBoost.length} recalled memor${boosted === 1 ? "y" : "ies"} (+${BOOST_DELTA})`);
  }
}

// ─── CONTEXT BUDGET ENFORCEMENT (Task 18) ───────────────────────────────────────

/**
 * Rough token estimator — 1 token ≈ 4 chars (conservative for XML-heavy content).
 * Used to enforce the context token budget before injecting.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate a memory label to fit within a character budget.
 * Appends ellipsis if truncated. Prefers word-boundary cuts.
 */
function truncateLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label;
  const cut = label.lastIndexOf(" ", maxChars - 3);
  const boundary = cut > maxChars * 0.6 ? cut : maxChars - 3;
  return label.slice(0, boundary) + "…";
}

/**
 * Given a list of memory items already sorted by heat desc, trim them to fit
 * within `tokenBudget` tokens (estimated). Returns the subset that fits.
 * Each item's label is also truncated if it alone would exceed the per-item cap.
 *
 * @param items        - Memory records with normalized `label` field, sorted by heat desc
 * @param tokenBudget  - Max tokens for the entire recall block
 * @param overhead     - Fixed overhead tokens already allocated elsewhere
 */
function enforceContextBudget(
  items: Array<{ label: string; [k: string]: unknown }>,
  tokenBudget: number,
  overhead: number
): Array<{ label: string; [k: string]: unknown }> {
  const remaining = tokenBudget - overhead;
  if (remaining <= 0) return [];

  // Per-item cap: a single memory should not dominate the budget.
  // Allow up to 40% of the remaining budget for any one item.
  const perItemCharCap = Math.floor((remaining * 4) * 0.4);

  const result: Array<{ label: string; [k: string]: unknown }> = [];
  let usedTokens = 0;

  for (const item of items) {
    const truncated = truncateLabel(item.label, perItemCharCap);
    const itemTokens = estimateTokens(truncated) + 8; // +8 for XML tag overhead
    if (usedTokens + itemTokens > remaining) break;
    result.push({ ...item, label: truncated });
    usedTokens += itemTokens;
  }

  return result;
}

// ─── DIVERSITY FILTER (Task 20) ───────────────────────────────────────────────

/**
 * Jaccard-penalised diversity filter — prevents the context window from being
 * filled with near-duplicate memories about the same thing.
 *
 * Algorithm (MMR-lite):
 *   1. Start with the highest-heat item as the first selected.
 *   2. For each remaining candidate, compute its max Jaccard similarity to
 *      any already-selected item.
 *   3. Score = heat * (1 - LAMBDA * maxSim)  where LAMBDA controls how
 *      strongly we penalise similarity (0 = pure heat, 1 = pure diversity).
 *   4. Pick the highest-scoring candidate next. Repeat until cap reached.
 *
 * This keeps the top result trustworthy (highest heat wins) while diversifying
 * the rest. A cap of `limit` prevents runaway expansion.
 */
const DIVERSITY_LAMBDA = 0.55; // penalty weight for similarity
const DIVERSITY_SIM_THRESHOLD = 0.65; // above this → considered near-duplicate

function diversityFilter(
  items: Array<{ label: string; _heat: number; [k: string]: unknown }>,
  limit: number
): typeof items {
  if (items.length <= 1) return items;

  const selected: typeof items = [];
  const remaining = [...items];

  // Always seed with the top-heat item
  const first = remaining.splice(0, 1)[0];
  selected.push(first);

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      // Max similarity to any already-selected item
      let maxSim = 0;
      for (const sel of selected) {
        const sim = topicTokenOverlap(candidate.label, sel.label);
        if (sim > maxSim) maxSim = sim;
      }
      // MMR score: balance heat vs novelty
      const score = candidate._heat * (1 - DIVERSITY_LAMBDA * maxSim);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    // Hard cutoff: skip if too similar to anything already in window
    // (score so low even penalised it won't help)
    const maxSimToSelected = selected.reduce((m, s) => {
      const sim = topicTokenOverlap(chosen.label, s.label);
      return sim > m ? sim : m;
    }, 0);
    if (maxSimToSelected < DIVERSITY_SIM_THRESHOLD) {
      selected.push(chosen);
    }
    // If similarity was too high, we still consumed the slot (prevents infinite loop)
    // but don't add it — effectively dropping the near-duplicate.
  }

  return selected;
}

// ─── CONFLICT DETECTION (Task 19) ──────────────────────────────────────────────

/**
 * Lightweight conflict detector — finds pairs of memories that share
 * significant topic overlap but where one contains negation/correction
 * language that may contradict the other, OR where both address the same
 * concept but one is substantially newer (stale vs updated).
 *
 * Returns pairs as { older, newer } with a reason string.
 * Capped at 3 conflict pairs to stay within token budget.
 */
const NEGATION_MARKERS = [
  "not ", "no longer", "never", "removed", "deprecated", "disabled",
  "changed", "replaced", "fixed", "incorrect", "wrong", "actually",
  "correction", "mistake", "was wrong", "instead", "update:",
];

function hasNegationMarker(text: string): boolean {
  const lower = text.toLowerCase();
  return NEGATION_MARKERS.some((m) => lower.includes(m));
}

function topicTokenOverlap(a: string, b: string): number {
  const ta = extractTopicTokens(a);
  const tb = extractTopicTokens(b);
  return topicOverlap(ta, tb);
}

function parseISOMs(iso: string | undefined): number {
  if (!iso) return 0;
  try { return new Date(iso).getTime(); } catch { return 0; }
}

interface ConflictPair {
  olderLabel: string;
  newerLabel: string;
  reason: "negation" | "staleness";
}

function detectConflicts(
  items: Array<{ label: string; memory_type?: string; updated_at?: string; [k: string]: unknown }>
): ConflictPair[] {
  const MAX_PAIRS = 3;
  const MIN_OVERLAP = 0.35; // minimum topic overlap to even compare
  const STALENESS_GAP_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const pairs: ConflictPair[] = [];
  const seen = new Set<string>(); // "i:j" to avoid duplicate pairs

  for (let i = 0; i < items.length && pairs.length < MAX_PAIRS; i++) {
    for (let j = i + 1; j < items.length && pairs.length < MAX_PAIRS; j++) {
      const pairKey = `${i}:${j}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const a = items[i];
      const b = items[j];
      const overlap = topicTokenOverlap(a.label, b.label);
      if (overlap < MIN_OVERLAP) continue;

      // Negation conflict: one item contains correction/negation language
      const aNeg = hasNegationMarker(a.label);
      const bNeg = hasNegationMarker(b.label);
      if (aNeg !== bNeg) {
        // One is a correction of the other
        const negItem = aNeg ? a : b;
        const posItem = aNeg ? b : a;
        pairs.push({
          olderLabel: truncateLabel(posItem.label, 80),
          newerLabel: truncateLabel(negItem.label, 80),
          reason: "negation",
        });
        continue;
      }

      // Staleness conflict: same topic but one is significantly newer
      const aMs = parseISOMs(a.updated_at as string | undefined);
      const bMs = parseISOMs(b.updated_at as string | undefined);
      if (aMs > 0 && bMs > 0 && Math.abs(aMs - bMs) > STALENESS_GAP_MS) {
        const older = aMs < bMs ? a : b;
        const newer = aMs < bMs ? b : a;
        pairs.push({
          olderLabel: truncateLabel(older.label, 80),
          newerLabel: truncateLabel(newer.label, 80),
          reason: "staleness",
        });
      }
    }
  }

  return pairs;
}

// ─── SDK RECALL HANDLER (for before_prompt_build with prependContext) ──────────

// Topic-shift detection constants (Task 14)
const TOPIC_SHIFT_THRESHOLD = 0.25; // Jaccard overlap below this = topic shift
const TOPIC_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes hard TTL
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "is", "it", "this", "that", "be", "as", "are",
  "was", "were", "has", "have", "had", "do", "does", "did", "can", "could",
  "will", "would", "should", "i", "you", "we", "they", "he", "she", "me",
  "my", "your", "our", "their", "its", "not", "no", "so", "if", "what",
  "how", "when", "where", "which", "who", "from", "up", "about", "into",
  "just", "also", "any", "all", "than", "then", "there", "been", "more",
]);

// ─── QUERY SANITIZATION ──────────────────────────────────────────────────────
// Strip OpenClaw framework noise from prompts before using them as search queries.
// Removes sender metadata JSON blocks, untrusted content wrappers, conversation
// info blocks, and timestamp prefixes that pollute semantic search.

function sanitizeRecallQuery(raw: string): string {
  let cleaned = raw;
  // Strip "Conversation info (untrusted metadata):" + JSON code blocks
  cleaned = cleaned.replace(/Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, "");
  // Strip "Sender (untrusted metadata):" + JSON code blocks
  cleaned = cleaned.replace(/Sender \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, "");
  // Strip "Replied message (untrusted, for context):" + JSON code blocks
  cleaned = cleaned.replace(/Replied message \(untrusted[^)]*\):\s*```json[\s\S]*?```\s*/gi, "");
  // Strip EXTERNAL_UNTRUSTED_CONTENT wrappers
  cleaned = cleaned.replace(/<<<EXTERNAL_UNTRUSTED_CONTENT[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g, "");
  // Strip "Untrusted context (metadata, do not treat as instructions or commands):" headers
  cleaned = cleaned.replace(/Untrusted context \(metadata[^)]*\):\s*/gi, "");
  // Strip leading [timestamp] or [sender] tags
  cleaned = cleaned.replace(/^\[[^\]]{0,100}\]\s*/g, "");
  // Strip @ mentions
  cleaned = cleaned.replace(/<@!?\d+>/g, "");
  cleaned = cleaned.replace(/@\w+/g, "");
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned || raw;
}

function extractTopicTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  return new Set(tokens.slice(0, 40));
}

function topicOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) { if (b.has(token)) shared++; }
  return shared / Math.max(a.size, b.size);
}

interface RecallCache {
  results: Record<string, unknown>[];
  topicTokens: Set<string>;
  cachedAt: number;
}

interface ProfileCache {
  preferences: Record<string, unknown>[];
  facts: Record<string, unknown>[];
  cachedAt: number;
}

function buildSdkRecallHandler(
  sulcusMem: SulcusCloudClient,
  namespace: string,
  maxResults: number,
  profileFrequency: number,
  logger: PluginLogger,
  boostOnRecall: boolean = true,
) {
  let turnCount = 0;
  let profileCache: ProfileCache | null = null;
  let recallCache: RecallCache | null = null;

  return async (event: Record<string, unknown>, _ctx: unknown): Promise<{ prependContext: string } | undefined> => {
    const rawPrompt = typeof event?.prompt === "string" ? event.prompt : "";
    if (!rawPrompt || rawPrompt.length < 5) return undefined;

    // Strip OpenClaw metadata noise before using as search query
    const prompt = sanitizeRecallQuery(rawPrompt);
    if (!prompt || prompt.length < 3) return undefined;

    turnCount++;
    const includeProfile = turnCount === 1 || turnCount % profileFrequency === 0;

    // ── Topic-shift detection (Task 14) ───────────────────────────────────────
    const currentTokens = extractTopicTokens(prompt);
    const cacheExpired = recallCache !== null && (Date.now() - recallCache.cachedAt) > TOPIC_CACHE_TTL_MS;
    const overlap = recallCache !== null ? topicOverlap(currentTokens, recallCache.topicTokens) : 0;
    const topicShifted = recallCache === null || cacheExpired || overlap < TOPIC_SHIFT_THRESHOLD;

    let searchResults: Record<string, unknown>[] = [];

    if (!topicShifted && recallCache !== null) {
      // Topic stable — reuse cached recall results, skip API call
      searchResults = recallCache.results;
      logger.info(`sulcus: topic stable (overlap=${overlap.toFixed(2)}) — serving cached recall (turn ${turnCount})`);
    } else {
      if (recallCache !== null) {
        logger.info(`sulcus: TOPIC SHIFT detected (overlap=${overlap.toFixed(2)}) — fresh recall (turn ${turnCount})`);
      }

    try {
      const searchRes = await sulcusMem.search_memory(prompt, maxResults, namespace);
      const vectorResults = searchRes?.results ?? [];

      // ── Graph-hop expansion (Task 13) ─────────────────────────────────────
      // Seed from top-2 vector results, fetch AGE neighbors non-blocking.
      // Fold in Memory-type neighbors (heat >= 0.2), dedup, cap at maxResults+4.
      searchResults = vectorResults;
      const seedIds = vectorResults.slice(0, 2).map((r) => r.id as string).filter(Boolean);
      if (seedIds.length > 0) {
        try {
          const neighborFetches = await Promise.allSettled(
            seedIds.map((id) => sulcusMem.graph_neighbors(id, 6))
          );
          const seenIds = new Set(vectorResults.map((r) => r.id as string));
          const graphExtras: Record<string, unknown>[] = [];
          for (const result of neighborFetches) {
            if (result.status !== "fulfilled") continue;
            for (const node of result.value) {
              const nodeId = node.id as string;
              if (!nodeId || seenIds.has(nodeId)) continue;
              const heat = (node.current_heat as number) ?? 0;
              // Only include meaningful nodes — skip cold ephemeral noise
              if (heat < 0.2) continue;
              seenIds.add(nodeId);
              graphExtras.push(node);
            }
          }
          if (graphExtras.length > 0) {
            // Sort graph extras by heat desc, cap at 4
            graphExtras.sort((a, b) => ((b.current_heat as number) ?? 0) - ((a.current_heat as number) ?? 0));
            // Tag graph-hop results with source so context formatter can annotate them
            const taggedExtras = graphExtras.slice(0, 4).map((r) => ({ ...r, _source: "graph" }));
            searchResults = [...vectorResults, ...taggedExtras];
            logger.info(`sulcus: graph-hop added ${Math.min(graphExtras.length, 4)} neighbours (seeds: ${seedIds.length})`);
          }
        } catch {
          // graph expansion failed — fall back to vector results only
        }
      }
      // ── end graph-hop ────────────────────────────────────────────────────

      // Update recall cache (fresh fetch path)
      recallCache = { results: searchResults, topicTokens: currentTokens, cachedAt: Date.now() };
    } catch (freshErr) {
      // fresh recall failed — fall back to cache if available
      if (recallCache !== null) {
        logger.warn(`sulcus: fresh recall failed (${freshErr}), using stale cache`);
        searchResults = recallCache.results;
      } else {
        throw freshErr; // no cache to fall back to — let outer catch handle
      }
    }
    } // end topic-shift branch

      let preferences: Record<string, unknown>[] = [];
      let facts: Record<string, unknown>[] = [];

      if (includeProfile) {
        try {
          const prefRes = await sulcusMem.search_memory("user preference", Math.min(maxResults, 5), namespace);
          const factRes = await sulcusMem.search_memory("fact data knowledge", Math.min(maxResults, 5), namespace);
          preferences = (prefRes?.results ?? []).filter((r) => r.memory_type === "preference");
          facts = (factRes?.results ?? []).filter((r) => r.memory_type === "fact");
          profileCache = { preferences, facts, cachedAt: Date.now() };
        } catch {
          // profile fetch failed — continue without
        }
      } else if (profileCache) {
        preferences = profileCache.preferences;
        facts = profileCache.facts;
      }

      const profileIds = new Set([
        ...preferences.map((r) => r.id as string),
        ...facts.map((r) => r.id as string),
      ]);
      const dedupedSearch = searchResults.filter((r) => !profileIds.has(r.id as string));

      // ── Task 20: Recall diversity filter ──────────────────────────────────────
      // Before budget enforcement: apply MMR-lite diversity filter to recall results.
      // Penalises near-duplicate memories (same topic, different phrasings) so the
      // context window surfaces genuinely distinct information.
      // Pre-normalise labels for topic extraction (strip XML escapes not needed yet).
      const preDiversityItems = dedupedSearch.map((r) => ({
        ...r,
        label: ((r.label ?? r.pointer_summary ?? r.id ?? "") as string),
        _heat: (r.current_heat as number) ?? (r.score as number) ?? 0,
      }));
      // Sort heat-desc first so diversity filter seeds on best item
      preDiversityItems.sort((a, b) => b._heat - a._heat);
      const diverseSearch = diversityFilter(preDiversityItems, maxResults);
      const droppedByDiversity = preDiversityItems.length - diverseSearch.length;
      if (droppedByDiversity > 0) {
        logger.info(`sulcus: diversity filter dropped ${droppedByDiversity} near-duplicate(s)`);
      }
      // ── end Task 20 ──────────────────────────────────────────────────────

      // ── Task 18: Context budget enforcement ────────────────────────────────────
      // ── Category-priority ranking (Mem0 parity) ──────────────────────────
      // Rank by memory type priority (durable types first), then by heat within tier.
      // Procedural and preference memories are high-priority (identity/config equivalent).
      // This ensures persistent knowledge surfaces before transient observations.
      const TYPE_PRIORITY: Record<string, number> = {
        procedural: 0, // how-tos = highest priority
        preference: 1, // user preferences = identity
        fact: 2,       // stable data
        semantic: 3,   // domain knowledge
        episodic: 4,   // events = lowest priority
      };
      diverseSearch.sort((a, b) => {
        const typeA = (a.memory_type as string) ?? "episodic";
        const typeB = (b.memory_type as string) ?? "episodic";
        const prioA = TYPE_PRIORITY[typeA] ?? 5;
        const prioB = TYPE_PRIORITY[typeB] ?? 5;
        if (prioA !== prioB) return prioA - prioB;
        return (b._heat as number) - (a._heat as number); // heat desc within tier
      });
      // ── end category-priority ranking ─────────────────────────────────────

      // Sort all items by heat desc so highest-value memories always fit first.
      // Budget: 500 tokens total. ~80 for fixed overhead (wrapper, guidance, session tag).
      // Remaining split ~30% profile / ~70% recall.
      const TOKEN_BUDGET = 500;
      const FIXED_OVERHEAD = 80;
      const profileBudgetTokens = Math.floor((TOKEN_BUDGET - FIXED_OVERHEAD) * 0.3);
      const recallBudgetTokens = TOKEN_BUDGET - FIXED_OVERHEAD - profileBudgetTokens;

      // Normalize + XML-escape labels up front, attach _heat for sorting
      const profileItemsSorted = [...preferences, ...facts]
        .map((r) => ({
          ...r,
          label: ((r.label ?? r.pointer_summary ?? r.id ?? "") as string)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
          _heat: (r.current_heat as number) ?? 0,
        }))
        .sort((a, b) => b._heat - a._heat);

      // Task 20: use diversity-filtered items (already heat-sorted by diversityFilter)
      const recallItemsSorted = diverseSearch
        .map((r) => ({
          ...r,
          label: ((r.label ?? r.pointer_summary ?? r.id ?? "") as string)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
          _heat: (r.current_heat as number) ?? (r.score as number) ?? 0,
        }));

      const budgetedProfile = enforceContextBudget(profileItemsSorted, TOKEN_BUDGET, FIXED_OVERHEAD + recallBudgetTokens);
      const budgetedRecall = enforceContextBudget(recallItemsSorted, TOKEN_BUDGET, FIXED_OVERHEAD + profileBudgetTokens);
      // ── end Task 18 ───────────────────────────────────────────────────────────

      const sections: string[] = [];

      // Task 18: use budgetedProfile (heat-sorted, budget-trimmed, labels already normalized)
      if (includeProfile && budgetedProfile.length > 0) {
        const profileElements: string[] = [];
        for (const r of budgetedProfile) {
          const mtype = (r.memory_type as string) === "fact" ? "fact" : "preference";
          const heat = (r._heat as number).toFixed(2);
          profileElements.push(`  <item type="${mtype}" heat="${heat}">${r.label}</item>`);
        }
        if (profileElements.length > 0) {
          sections.push(`<profile>\n${profileElements.join("\n")}\n</profile>`);
        }
      }

      if (budgetedRecall.length > 0) {
        // ── Task 12: Structured context formatting ────────────────────────────
        // Group recall items by memory type so LLM receives semantically
        // coherent blocks. Add source (vector/graph) and relevance tier.
        // Task 18: iterate over budgetedRecall instead of raw dedupedSearch —
        //   already heat-sorted, budget-trimmed, labels normalized.
        const heatToRelevance = (h: number): string => h >= 0.6 ? "high" : h >= 0.35 ? "medium" : "low";
        const typeOrder = ["procedural", "semantic", "fact", "episodic", "preference"];
        const grouped = new Map<string, string[]>();
        for (const r of budgetedRecall) {
          const heat = r._heat as number;
          const heatStr = heat.toFixed(2);
          const mtype = (r.memory_type as string) ?? "episodic";
          const updatedAt = r.updated_at as string | undefined;
          const ageStr = updatedAt ? formatRelativeTime(updatedAt) : "unknown";
          const source = (r._source as string) === "graph" ? "graph" : "vector";
          const relevance = heatToRelevance(heat);
          // label already normalized + escaped + budget-truncated by enforceContextBudget
          const el = `    <memory heat="${heatStr}" age="${ageStr}" source="${source}" relevance="${relevance}">${r.label}</memory>`;
          if (!grouped.has(mtype)) grouped.set(mtype, []);
          grouped.get(mtype)!.push(el);
        }
        // Emit groups in stable order — most durable types first
        const recallBlocks: string[] = [];
        const seenTypes = new Set(grouped.keys());
        for (const t of [...typeOrder, ...Array.from(seenTypes).filter((t) => !typeOrder.includes(t))]) {
          const els = grouped.get(t);
          if (!els || els.length === 0) continue;
          recallBlocks.push(`  <group type="${t}" count="${els.length}">\n${els.join("\n")}\n  </group>`);
        }
        if (recallBlocks.length > 0) {
          sections.push(`<recall>\n${recallBlocks.join("\n")}\n</recall>`);
        }
        // ── end Task 12 / Task 18 ─────────────────────────────────────────────────
      }

      // ── Task 19: Conflict surfacing ─────────────────────────────────────────
      // Detect contradicting memories and surface them as a <conflicts> block.
      // Use diversity-filtered items (Task 20) — they are pre-deduplicated.
      // Conflict detection on diverse results avoids false-positive conflict pairs
      // that were actually just duplicate phrasing of the same fact.
      const conflictCandidates = diverseSearch.map((r) => ({
        ...r,
        label: ((r.label ?? r.pointer_summary ?? r.id ?? "") as string)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
        updated_at: r.updated_at as string | undefined,
      }));
      const conflictPairs = detectConflicts(conflictCandidates);
      if (conflictPairs.length > 0) {
        const conflictEls = conflictPairs.map((p) => {
          const reasonNote = p.reason === "negation"
            ? "one memory appears to correct or negate the other"
            : "similar topic but memories are from very different times";
          return `  <conflict reason="${p.reason}" note="${reasonNote}">
    <older>${p.olderLabel}</older>
    <newer>${p.newerLabel}</newer>
  </conflict>`;
        });
        sections.push(`<conflicts note="Potentially contradictory memories — trust newer/corrective entries">
${conflictEls.join("\n")}
</conflicts>`);
        logger.info(`sulcus: conflict surfacing found ${conflictPairs.length} pair(s)`);
      }
      // ── end Task 19 ───────────────────────────────────────────────────────────

      if (sections.length === 0) return undefined;

      const guidance = "Background context from long-term memory. Use it silently to inform your understanding — only surface it when the conversation naturally calls for it.";
      const recallMode = !topicShifted ? "cached" : "fresh";
      const contextParts: string[] = [
        `<session turn="${turnCount}" mode="${recallMode}" />`,
        `<guidance>${guidance}</guidance>`,
      ];
      contextParts.push(...sections);
      const context = `<sulcus_context token_budget="${TOKEN_BUDGET}" namespace="${namespace}">\n${contextParts.join("\n")}\n</sulcus_context>`;

      // Task 18: log budget utilisation
      const estimatedTokens = estimateTokens(context);
      logger.info(`sulcus: SDK recall injecting context (${context.length} chars, ~${estimatedTokens}/${TOKEN_BUDGET} tokens, turn ${turnCount}, profile: ${budgetedProfile.length}, recall: ${budgetedRecall.length})`);

      // Spaced repetition: boost heat for recalled memories (fire-and-forget, non-blocking)
      if (boostOnRecall && budgetedRecall.length > 0) {
        boostRecalledMemories(sulcusMem, budgetedRecall, logger).catch(() => {});
      }

      // ── Task 23: SIRU recall logging (fire-and-forget, only on fresh recall) ────
      // Post recall session metadata to the server so SIRU can learn which memories
      // were most useful. Skipped on cache-hit turns (topicShifted === false) to avoid
      // logging identical sessions when the topic is stable.
      if (topicShifted && sulcusMem instanceof SulcusCloudClient) {
        const recallIds = budgetedRecall.map((r) => (r.id as string) ?? "").filter(Boolean);
        const recallScores = budgetedRecall.map((r) => (r._heat as number) ?? 0);
        const recallSources = budgetedRecall.map((r) =>
          (r._source as string) === "graph" ? "graph" : "semantic"
        );
        // Extract entity hints from prompt (reuse topic tokens as lightweight entity proxy)
        const entityHints = Array.from(currentTokens).slice(0, 10);
        // Source breakdown counts
        const semanticCount = recallSources.filter((s) => s === "semantic").length;
        const graphCount = recallSources.filter((s) => s === "graph").length;
        sulcusMem.recall_log({
          namespace,
          agent_id: namespace,
          query_text: prompt.substring(0, 500),
          memory_ids: recallIds,
          memory_scores: recallScores,
          memory_sources: recallSources,
          token_budget: TOKEN_BUDGET,
          tokens_used: estimatedTokens,
          candidates_total: searchResults.length,
          candidates_selected: recallIds.length,
          semantic_count: semanticCount,
          hot_count: graphCount,
          entity_count: entityHints.length,
          entity_hints: entityHints,
        }).catch(() => {}); // never block context injection
        logger.debug?.("sulcus: SIRU recall log posted");
      }
      // ── end Task 23 ───────────────────────────────────────────────────────────

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
  if (params.availableTools.has("memory_get")) lines.push("- Use `memory_get` to fetch a specific memory by its UUID.");
  if (params.availableTools.has("memory_list")) lines.push("- Use `memory_list` to browse memories by type, heat, or pinned status (paginated).");
  if (params.availableTools.has("memory_update")) lines.push("- Use `memory_update` to update a memory in-place (content, type, heat, pin). Preserves graph edges.");
  if (params.availableTools.has("memory_delete")) lines.push("- Use `memory_delete` to remove incorrect or stale memories.");
  if (params.availableTools.has("memory_status")) lines.push("- Use `memory_status` to check backend connection and hot nodes.");
  if (params.availableTools.has("memory_profile")) lines.push("- Use `memory_profile` to see a rich snapshot of memory health: type distribution, heat curve, top preferences/facts, and graph stats.");
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
        // Phase 2: SILU prompt injection — derive hints from memory type + namespace for manual stores
        const storeHints = buildExtractionHints(mtype, namespace, "user_capture", content.substring(0, 200));
        const res = await sulcusMem.add_memory(content, mtype, storeHints);
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

  memory_get: {
    schema: {
      name: "memory_get",
      label: "Get Memory",
      description: "Fetch a specific memory by its UUID. Returns full memory details including content, type, heat, graph edges, and metadata.",
      parameters: Type.Object({
        id: Type.String({ description: "Memory node UUID." }),
      }),
    },
    options: { name: "memory_get" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) =>
      async (_id, params) => {
        if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
        if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("memory_get requires cloud backend");
        const memId = params.id as string;
        const res = await sulcusMem.get_memory(memId);
        if (!res) return { content: [{ type: "text", text: `Memory ${memId} not found.` }], details: { found: false, id: memId } };
        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
          details: { ...res, backend: backendMode, namespace },
        };
      },
  },

  memory_list: {
    schema: {
      name: "memory_list",
      label: "List Memories",
      description: "Browse memories with optional filters. Returns paginated results sorted by heat (hottest first). Use this to explore what Sulcus knows without a search query.",
      parameters: Type.Object({
        page: Type.Optional(Type.Number({ default: 1, description: "Page number (1-indexed)." })),
        page_size: Type.Optional(Type.Number({ default: 20, description: "Results per page (1-100).", minimum: 1, maximum: 100 })),
        memory_type: Type.Optional(Type.Union([
          Type.Literal("episodic"), Type.Literal("semantic"), Type.Literal("preference"),
          Type.Literal("procedural"), Type.Literal("fact"),
        ], { description: "Filter by memory type." })),
        pinned: Type.Optional(Type.Boolean({ description: "Filter by pinned status." })),
        sort_by: Type.Optional(Type.Union([
          Type.Literal("current_heat"), Type.Literal("created_at"), Type.Literal("updated_at"),
        ], { description: "Sort field (default: current_heat)." })),
        sort_order: Type.Optional(Type.Union([
          Type.Literal("asc"), Type.Literal("desc"),
        ], { description: "Sort order (default: desc)." })),
      }),
    },
    options: { name: "memory_list" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) =>
      async (_id, params) => {
        if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
        if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("memory_list requires cloud backend");
        const page = (params.page as number | undefined) ?? 1;
        const pageSize = Math.min(100, Math.max(1, (params.page_size as number | undefined) ?? 20));
        const res = await sulcusMem.list_memories({
          page,
          page_size: pageSize,
          memory_type: params.memory_type as string | undefined,
          pinned: params.pinned as boolean | undefined,
          sort_by: (params.sort_by as string | undefined) ?? "current_heat",
          sort_order: (params.sort_order as string | undefined) ?? "desc",
          namespace,
        });
        const summary = `Page ${page} — ${res.items.length} memories${res.total !== undefined ? ` (${res.total} total)` : ""}`;
        return {
          content: [{ type: "text", text: summary + "\n" + JSON.stringify(res.items, null, 2) }],
          details: { page, page_size: pageSize, count: res.items.length, total: res.total, backend: backendMode, namespace },
        };
      },
  },

  memory_update: {
    schema: {
      name: "memory_update",
      label: "Update Memory",
      description: "Update fields on an existing memory in-place. Preserves graph edges and history. More surgical than delete+re-store.",
      parameters: Type.Object({
        id: Type.String({ description: "Memory node UUID to update." }),
        content: Type.Optional(Type.String({ description: "New content text (replaces existing)." })),
        memory_type: Type.Optional(Type.Union([
          Type.Literal("episodic"), Type.Literal("semantic"), Type.Literal("preference"),
          Type.Literal("procedural"), Type.Literal("fact"),
        ], { description: "New memory type classification." })),
        is_pinned: Type.Optional(Type.Boolean({ description: "Pin (prevent decay) or unpin." })),
        heat: Type.Optional(Type.Number({ description: "Set heat directly (0.0-1.0).", minimum: 0, maximum: 1 })),
      }),
    },
    options: { name: "memory_update" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable, logger }) =>
      async (_id, params) => {
        if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
        if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("memory_update requires cloud backend");
        const memId = params.id as string;
        const updates: Record<string, unknown> = {};
        if (params.content !== undefined) updates.label = params.content as string;
        if (params.memory_type !== undefined) updates.memory_type = params.memory_type as string;
        if (params.is_pinned !== undefined) updates.is_pinned = params.is_pinned as boolean;
        if (params.heat !== undefined) updates.current_heat = params.heat as number;
        if (Object.keys(updates).length === 0) {
          return { content: [{ type: "text", text: "No fields to update. Provide at least one of: content, memory_type, is_pinned, heat." }] };
        }
        const res = await sulcusMem.update_memory(memId, updates as any);
        const fields = Object.keys(updates).join(", ");
        logger.info(`sulcus: memory_update — updated ${memId} (fields: ${fields})`);
        return {
          content: [{ type: "text", text: `Updated memory ${memId} (fields: ${fields}). Backend: ${backendMode}, namespace: ${namespace}` }],
          details: { id: memId, updated_fields: Object.keys(updates), result: res as Record<string, unknown>, backend: backendMode, namespace },
        };
      },
  },

  memory_profile: {
    schema: {
      name: "memory_profile",
      label: "Memory Profile",
      description: "Show a rich snapshot of this agent's memory health: type distribution, heat curve, top hot nodes, top preferences/facts, and graph stats. Call this to understand what Sulcus knows and how active the memory is.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: "Max hot nodes to surface (default 10).", minimum: 1, maximum: 50 })),
      }),
    },
    options: { name: "memory_profile" },
    makeExecute: ({ sulcusMem, backendMode, namespace, isAvailable }) =>
      async (_id, params) => {
        if (!isAvailable || !sulcusMem) {
          return { content: [{ type: "text", text: `Memory profile unavailable — backend: ${backendMode}, namespace: ${namespace}` }] };
        }
        const hotLimit = Math.min(50, Math.max(1, (params?.limit as number | undefined) ?? 10));
        try {
          const [statusRes, hotRes, prefRes, factRes] = await Promise.allSettled([
            (sulcusMem as SulcusCloudClient).request("GET", "/api/v1/agent/memory/status").catch(() => null),
            (sulcusMem as SulcusCloudClient).list_hot_nodes(hotLimit),
            (sulcusMem as SulcusCloudClient).search_memory("preference", hotLimit),
            (sulcusMem as SulcusCloudClient).search_memory("fact", hotLimit),
          ]);

          const status = (statusRes.status === "fulfilled" ? statusRes.value : null) as Record<string, unknown> | null;
          const hotNodes = (hotRes.status === "fulfilled" ? hotRes.value?.nodes : []) ?? [];
          const preferences = (prefRes.status === "fulfilled" ? prefRes.value?.results : []) ?? [];
          const facts = (factRes.status === "fulfilled" ? factRes.value?.results : []) ?? [];

          // Filter preferences/facts by type
          const prefItems = (preferences as Record<string, unknown>[]).filter(
            (r) => (r.memory_type ?? r.type) === "preference"
          ).slice(0, 5);
          const factItems = (facts as Record<string, unknown>[]).filter(
            (r) => (r.memory_type ?? r.type) === "fact"
          ).slice(0, 5);

          const stats = status?.stats as Record<string, unknown> | undefined;
          const caps = status?.capabilities as Record<string, unknown> | undefined;

          // Build human-readable summary
          const lines: string[] = [];
          lines.push(`## 🧠 Sulcus Memory Profile`);
          lines.push(`**Namespace:** ${namespace} | **Backend:** ${backendMode}`);
          lines.push("");

          if (stats) {
            const total = (stats.total_nodes ?? stats.total ?? "?") as string | number;
            const hot = (stats.hot_nodes ?? "?") as string | number;
            const cold = (stats.cold_nodes ?? "?") as string | number;
            const avgHeat = typeof stats.average_heat === "number" ? (stats.average_heat * 100).toFixed(1) + "%" : "?";
            lines.push(`### Memory Stats`);
            lines.push(`- **Total nodes:** ${total}`);
            lines.push(`- **Hot / Cold:** ${hot} hot / ${cold} cold`);
            lines.push(`- **Average heat:** ${avgHeat}`);
            if (stats.memory_types && Array.isArray(stats.memory_types)) {
              const types = (stats.memory_types as { type: string; count: number }[])
                .sort((a, b) => b.count - a.count)
                .map((t) => `${t.type}: ${t.count}`)
                .join(" | ");
              lines.push(`- **By type:** ${types}`);
            }
            lines.push("");
          }

          if (caps) {
            const enabled = Object.entries(caps)
              .filter(([, v]) => v === true)
              .map(([k]) => k)
              .join(", ");
            if (enabled) lines.push(`**Active capabilities:** ${enabled}\n`);
          }

          if (hotNodes.length > 0) {
            lines.push(`### 🔥 Top Hot Nodes (${hotNodes.length})`);
            for (const n of (hotNodes as Record<string, unknown>[]).slice(0, hotLimit)) {
              const heat = typeof n.current_heat === "number" ? (n.current_heat * 100).toFixed(0) + "%" : "?";
              const mtype = (n.memory_type ?? n.type ?? "?") as string;
              const label = ((n.summary ?? n.label ?? n.content ?? "") as string).slice(0, 80);
              lines.push(`- [${heat} ${mtype}] ${label}`);
            }
            lines.push("");
          }

          if (prefItems.length > 0) {
            lines.push(`### 📌 Active Preferences`);
            for (const p of prefItems) {
              const heat = typeof p.current_heat === "number" ? (p.current_heat * 100).toFixed(0) + "%" : "?";
              const label = ((p.summary ?? p.label ?? p.content ?? "") as string).slice(0, 100);
              lines.push(`- [${heat}] ${label}`);
            }
            lines.push("");
          }

          if (factItems.length > 0) {
            lines.push(`### 📚 Active Facts`);
            for (const f of factItems) {
              const heat = typeof f.current_heat === "number" ? (f.current_heat * 100).toFixed(0) + "%" : "?";
              const label = ((f.summary ?? f.label ?? f.content ?? "") as string).slice(0, 100);
              lines.push(`- [${heat}] ${label}`);
            }
            lines.push("");
          }

          const summary = lines.join("\n");
          return {
            content: [{ type: "text", text: summary }],
            details: { backend: backendMode, namespace, hot_count: hotNodes.length, pref_count: prefItems.length, fact_count: factItems.length },
          };
        } catch (e: unknown) {
          return { content: [{ type: "text", text: `Memory profile error: ${e instanceof Error ? e.message : String(e)}` }] };
        }
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

// ─── FIRST-INSTALL HISTORY IMPORT ────────────────────────────────────────────

async function importOpenClawHistory(sulcusMem: SulcusCloudClient, logger: PluginLogger): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as {
    existsSync: (p: string) => boolean;
    readFileSync: (p: string, enc: string) => string;
    readdirSync: (p: string) => string[];
    statSync: (p: string) => { mtimeMs: number };
    writeFileSync: (p: string, d: string, enc: string) => void;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as { join: (...args: string[]) => string };

  const workspaceDir = process.env.OPENCLAW_WORKSPACE
    ? resolve(process.env.OPENCLAW_WORKSPACE)
    : resolve(process.env.HOME || "~", ".openclaw/workspace");
  const markerPath = path.join(workspaceDir, ".sulcus-imported");

  if (fs.existsSync(markerPath)) return;

  logger.info("sulcus: first-install history import starting...");

  const memories: string[] = [];

  const memoryMdPath = path.join(workspaceDir, "MEMORY.md");
  if (fs.existsSync(memoryMdPath)) {
    try {
      const text = fs.readFileSync(memoryMdPath, "utf-8");
      const entries = text.split(/\n(?:---+|\s*\n\s*\n)/g).map((s) => s.trim()).filter((s) => s.length > 20);
      memories.push(...entries);
    } catch (_e) { /* best-effort */ }
  }

  const memDir = path.join(workspaceDir, "memory");
  if (fs.existsSync(memDir)) {
    try {
      const files = fs.readdirSync(memDir);
      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      for (const file of files) {
        if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file)) continue;
        try {
          const stat = fs.statSync(path.join(memDir, file));
          if (now - stat.mtimeMs > thirtyDaysMs) continue;
          const text = fs.readFileSync(path.join(memDir, file), "utf-8");
          const entries = text.split(/\n---\n/g).map((s) => s.trim()).filter((s) => s.length > 20);
          memories.push(...entries);
        } catch (_e) { /* best-effort */ }
      }
    } catch (_e) { /* best-effort */ }
  }

  let stored = 0;
  for (const mem of memories) {
    try {
      await sulcusMem.add_memory(mem, "episodic");
      stored++;
    } catch (_e) { /* best-effort */ }
  }

  try {
    fs.writeFileSync(markerPath, new Date().toISOString(), "utf-8");
    logger.info(`sulcus: history import complete — stored ${stored} memories from OpenClaw workspace`);
  } catch (_e) { /* best-effort */ }
}

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
    const libDir = pluginConfig?.libDir
      ? resolve(pluginConfig.libDir as string)
      : resolve(process.env.HOME || "~", ".sulcus/lib");

    // Auto-create directories on first run (self-healing)
    const dataDir = resolve(process.env.HOME || "~", ".sulcus/data");
    for (const dir of [libDir, dataDir]) {
      if (!existsSync(dir)) {
        try {
          mkdirSync(dir, { recursive: true });
          logger.info(`sulcus: created directory ${dir}`);
        } catch { /* best effort — may be read-only in containers */ }
      }
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
    const boostOnRecallEnabled: boolean = (pluginConfig?.boostOnRecall as boolean | undefined) ?? true;

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
      boostOnRecall: boostOnRecallEnabled,
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
          boostOnRecallEnabled,
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
        // Task 25: Lowered from 0.5 → 0.4 — SIVU gate was too aggressive,
        // rejecting real architectural/technical content that scored in the
        // 0.4–0.5 range. 0.4 is still well above noise threshold (< 0.2).
        min_store_confidence: 0.4,
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
    // DREAM AUTO-TRIGGER (Phase 4)
    // Cheap local gates → expensive API call → fire-and-forget consolidation.
    // Gate cascade: session counter → time gap → memory count → lock → execute.
    // ─────────────────────────────────────────────────────────────────────────

    const dreamEnabled = (pluginConfig?.dreamAutoTrigger as boolean) !== false; // default: true
    const dreamSessionInterval = (pluginConfig?.dreamSessionInterval as number) ?? 10;
    const dreamMinGapMs = ((pluginConfig?.dreamMinGapHours as number) ?? 24) * 3600_000;
    const dreamMinMemories = (pluginConfig?.dreamMinMemories as number) ?? 50;
    const dreamMinHeat = (pluginConfig?.dreamConsolidateMinHeat as number) ?? 0.1;

    if (dreamEnabled && isAvailable && sulcusMem instanceof SulcusCloudClient) {
      // State file for cross-session persistence
      const stateDir = resolve(__dirname, ".sulcus-state");
      if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
      const dreamStateFile = resolve(stateDir, "dream-state.json");
      const dreamLockFile = resolve(stateDir, "dream.lock");

      // In-memory session counter (resets on gateway restart, which is fine)
      let dreamSessionCount = 0;

      // Read persisted state
      function readDreamState(): { lastDreamMs: number; lastSessionCount: number } {
        try {
          if (existsSync(dreamStateFile)) {
            const raw = readFileSync(dreamStateFile, "utf-8");
            const parsed = JSON.parse(raw);
            return {
              lastDreamMs: typeof parsed.lastDreamMs === "number" ? parsed.lastDreamMs : 0,
              lastSessionCount: typeof parsed.lastSessionCount === "number" ? parsed.lastSessionCount : 0,
            };
          }
        } catch { /* corrupted state = treat as fresh */ }
        return { lastDreamMs: 0, lastSessionCount: 0 };
      }

      function writeDreamState(state: { lastDreamMs: number; lastSessionCount: number }): void {
        try { writeFileSync(dreamStateFile, JSON.stringify(state)); } catch { /* best effort */ }
      }

      // Simple file lock (not bulletproof, but prevents obvious races)
      function acquireDreamLock(): boolean {
        try {
          if (existsSync(dreamLockFile)) {
            const lockAge = Date.now() - (JSON.parse(readFileSync(dreamLockFile, "utf-8")).ts ?? 0);
            if (lockAge < 600_000) return false; // Lock held < 10 min = still running
            // Stale lock — claim it
          }
          writeFileSync(dreamLockFile, JSON.stringify({ ts: Date.now(), pid: process.pid }));
          return true;
        } catch { return false; }
      }

      function releaseDreamLock(): void {
        try { if (existsSync(dreamLockFile)) require("node:fs").unlinkSync(dreamLockFile); } catch { /* best effort */ }
      }

      // Register on before_prompt_build to count sessions (cheap — just increment)
      const origBeforePromptBuild = api.on as (event: string, handler: unknown) => void;
      origBeforePromptBuild("session_start", async () => {
        dreamSessionCount++;
      });

      // Register on agent_end to check dream gates
      const dreamApiOn = api.on as (event: string, handler: unknown) => void;
      dreamApiOn("agent_end", async () => {
        // Gate 1 (free): Session counter — only check every N sessions
        if (dreamSessionCount % dreamSessionInterval !== 0) return;
        if (dreamSessionCount === 0) return; // Skip first session

        // Gate 2 (free): Time gap — minimum hours since last dream
        const state = readDreamState();
        const elapsed = Date.now() - state.lastDreamMs;
        if (elapsed < dreamMinGapMs) {
          logger.info(`sulcus/dream: gate 2 skip — ${Math.round(elapsed / 3600_000)}h since last dream (need ${Math.round(dreamMinGapMs / 3600_000)}h)`);
          return;
        }

        // Gate 3 (cheap API): Memory count — only consolidate if enough memories exist
        try {
          const statusResp = await (sulcusMem as SulcusCloudClient).request("GET", "/api/v1/agent/memory/status") as Record<string, unknown> | null;
          const stats = statusResp?.stats as Record<string, unknown> | undefined;
          const totalMemories = typeof stats?.total_memories === "number" ? stats.total_memories as number : 0;
          if (totalMemories < dreamMinMemories) {
            logger.info(`sulcus/dream: gate 3 skip — ${totalMemories} memories (need ${dreamMinMemories})`);
            return;
          }
          logger.info(`sulcus/dream: gates passed — ${totalMemories} memories, ${Math.round(elapsed / 3600_000)}h since last dream`);
        } catch (e: unknown) {
          logger.warn(`sulcus/dream: gate 3 error — ${e instanceof Error ? e.message : e}`);
          return;
        }

        // Gate 4 (lock): Prevent concurrent consolidation
        if (!acquireDreamLock()) {
          logger.info("sulcus/dream: lock held — another consolidation in progress");
          return;
        }

        // Execute: Fire-and-forget consolidation
        logger.info(`sulcus/dream: triggering consolidation (minHeat=${dreamMinHeat})`);
        (sulcusMem as SulcusCloudClient).consolidate(dreamMinHeat)
          .then((result: unknown) => {
            writeDreamState({ lastDreamMs: Date.now(), lastSessionCount: dreamSessionCount });
            logger.info(`sulcus/dream: consolidation complete — ${JSON.stringify(result)}`);
          })
          .catch((e: unknown) => {
            logger.warn(`sulcus/dream: consolidation failed — ${e instanceof Error ? e.message : e}`);
          })
          .finally(() => {
            releaseDreamLock();
          });
      });

      logger.info(`sulcus: dream auto-trigger enabled (every ${dreamSessionInterval} sessions, ${Math.round(dreamMinGapMs / 3600_000)}h gap, min ${dreamMinMemories} memories)`);
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

    // ─────────────────────────────────────────────────────────────────────────
    // CLI REGISTRATION (Phase 3: `openclaw sulcus <subcommand>`)
    // ─────────────────────────────────────────────────────────────────────────

    const registerCli = api.registerCli as ((registrar: (ctx: { program: any; config: any; logger: any }) => void, opts?: any) => void) | undefined;
    if (typeof registerCli === "function") {
      registerCli((ctx: { program: any; config: any; logger: any }) => {
        const sulcusCmd = ctx.program.command("sulcus").description("Sulcus memory management");

        // --- openclaw sulcus status ---
        sulcusCmd.command("status")
          .description("Check Sulcus connection, config, and memory stats")
          .option("--json", "Machine-readable JSON output")
          .action(async (opts: { json?: boolean }) => {
            if (!isAvailable || !sulcusMem) {
              const out = { status: "unavailable", backend: backendMode, namespace, error: "Backend not connected" };
              if (opts.json) { console.log(JSON.stringify(out, null, 2)); } else {
                console.log(`Status: unavailable`);
                console.log(`Backend: ${backendMode}`);
                console.log(`Namespace: ${namespace}`);
                if (serverUrl) console.log(`Server: ${serverUrl}`);
                console.log(`\nRun \`openclaw sulcus init\` to configure.`);
              }
              return;
            }
            try {
              const status = await (sulcusMem as SulcusCloudClient).request("GET", "/api/v1/agent/memory/status") as Record<string, unknown> | null;
              const hot = await (sulcusMem as SulcusCloudClient).list_hot_nodes(5);
              const out = {
                status: "connected",
                backend: backendMode,
                namespace,
                server: serverUrl,
                autoRecall,
                autoCapture,
                ...(status?.stats ? { stats: status.stats } : {}),
                ...(status?.capabilities ? { capabilities: status.capabilities } : {}),
                hot_nodes: (hot.nodes || []).length,
              };
              if (opts.json) { console.log(JSON.stringify(out, null, 2)); } else {
                console.log(`Status: connected \u2705`);
                console.log(`Backend: ${backendMode}`);
                console.log(`Namespace: ${namespace}`);
                console.log(`Server: ${serverUrl}`);
                console.log(`Auto-recall: ${autoRecall}`);
                console.log(`Auto-capture: ${autoCapture}`);
                const stats = status?.stats as Record<string, unknown> | undefined;
                if (stats?.total_memories !== undefined) console.log(`Memories: ${stats.total_memories}`);
                if (stats?.average_heat !== undefined) console.log(`Average heat: ${(stats.average_heat as number).toFixed(3)}`);
                console.log(`Hot nodes: ${(hot.nodes || []).length}`);
              }
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              if (opts.json) { console.log(JSON.stringify({ status: "error", error: msg })); }
              else { console.error(`Error: ${msg}`); }
            }
          });

        // --- openclaw sulcus search ---
        sulcusCmd.command("search <query>")
          .description("Search memories")
          .option("-n, --limit <n>", "Max results", "10")
          .option("--json", "Machine-readable JSON output")
          .action(async (query: string, opts: { limit: string; json?: boolean }) => {
            if (!isAvailable || !sulcusMem) { console.error("Sulcus not connected."); return; }
            try {
              const res = await sulcusMem.search_memory(query, parseInt(opts.limit, 10), namespace);
              const results = res?.results ?? [];
              if (opts.json) { console.log(JSON.stringify(results, null, 2)); return; }
              if (results.length === 0) { console.log("No results."); return; }
              for (const r of results) {
                const heat = typeof r.current_heat === "number" ? (r.current_heat * 100).toFixed(0) + "%" : "?";
                const mtype = (r.memory_type ?? "?") as string;
                const label = ((r.label ?? r.content ?? "") as string).slice(0, 120);
                console.log(`[${heat} ${mtype}] ${label}`);
                console.log(`  id: ${r.id}`);
              }
              console.log(`\n${results.length} result(s)`);
            } catch (e: unknown) { console.error(`Error: ${e instanceof Error ? e.message : e}`); }
          });

        // --- openclaw sulcus add ---
        sulcusCmd.command("add <content>")
          .description("Store a memory")
          .option("-t, --type <type>", "Memory type", "semantic")
          .option("--json", "Machine-readable JSON output")
          .action(async (content: string, opts: { type: string; json?: boolean }) => {
            if (!isAvailable || !sulcusMem) { console.error("Sulcus not connected."); return; }
            try {
              const hints = buildExtractionHints(opts.type, namespace, "cli_add", content.substring(0, 200));
              const res = await sulcusMem.add_memory(content, opts.type, hints);
              if (opts.json) { console.log(JSON.stringify(res, null, 2)); }
              else { console.log(`Stored [${opts.type}] memory (id: ${res?.id ?? "?"})`); }
            } catch (e: unknown) { console.error(`Error: ${e instanceof Error ? e.message : e}`); }
          });

        // --- openclaw sulcus get ---
        sulcusCmd.command("get <id>")
          .description("Fetch a memory by ID")
          .option("--json", "Machine-readable JSON output")
          .action(async (id: string, opts: { json?: boolean }) => {
            if (!isAvailable || !(sulcusMem instanceof SulcusCloudClient)) { console.error("Sulcus not connected."); return; }
            try {
              const res = await sulcusMem.get_memory(id);
              if (!res) { console.log(`Memory ${id} not found.`); return; }
              if (opts.json) { console.log(JSON.stringify(res, null, 2)); } else {
                const heat = typeof res.current_heat === "number" ? ((res.current_heat as number) * 100).toFixed(0) + "%" : "?";
                console.log(`ID: ${res.id}`);
                console.log(`Type: ${res.memory_type ?? "?"}`); console.log(`Heat: ${heat}`);
                console.log(`Pinned: ${res.is_pinned ?? false}`);
                console.log(`Content: ${((res.label ?? res.content ?? "") as string).slice(0, 500)}`);
              }
            } catch (e: unknown) { console.error(`Error: ${e instanceof Error ? e.message : e}`); }
          });

        // --- openclaw sulcus list ---
        sulcusCmd.command("list")
          .description("List memories")
          .option("-n, --limit <n>", "Max results", "20")
          .option("-t, --type <type>", "Filter by memory type")
          .option("--pinned", "Only pinned memories")
          .option("--sort <field>", "Sort by: current_heat, created_at, updated_at", "current_heat")
          .option("--json", "Machine-readable JSON output")
          .action(async (opts: { limit: string; type?: string; pinned?: boolean; sort: string; json?: boolean }) => {
            if (!isAvailable || !(sulcusMem instanceof SulcusCloudClient)) { console.error("Sulcus not connected."); return; }
            try {
              const res = await sulcusMem.list_memories({
                page_size: parseInt(opts.limit, 10),
                memory_type: opts.type,
                pinned: opts.pinned,
                sort_by: opts.sort,
                sort_order: "desc",
                namespace,
              });
              if (opts.json) { console.log(JSON.stringify(res, null, 2)); return; }
              if (res.items.length === 0) { console.log("No memories."); return; }
              for (const r of res.items) {
                const heat = typeof r.current_heat === "number" ? ((r.current_heat as number) * 100).toFixed(0) + "%" : "?";
                const mtype = (r.memory_type ?? "?") as string;
                const label = ((r.label ?? r.content ?? "") as string).slice(0, 100);
                console.log(`[${heat} ${mtype}] ${label}`);
                console.log(`  id: ${r.id}`);
              }
              console.log(`\n${res.items.length} shown${res.total ? ` of ${res.total}` : ""}`);
            } catch (e: unknown) { console.error(`Error: ${e instanceof Error ? e.message : e}`); }
          });

        // --- openclaw sulcus update ---
        sulcusCmd.command("update <id>")
          .description("Update a memory")
          .option("-c, --content <text>", "New content")
          .option("-t, --type <type>", "New memory type")
          .option("--pin", "Pin the memory")
          .option("--unpin", "Unpin the memory")
          .option("--heat <value>", "Set heat (0.0-1.0)")
          .option("--json", "Machine-readable JSON output")
          .action(async (id: string, opts: { content?: string; type?: string; pin?: boolean; unpin?: boolean; heat?: string; json?: boolean }) => {
            if (!isAvailable || !(sulcusMem instanceof SulcusCloudClient)) { console.error("Sulcus not connected."); return; }
            const updates: Record<string, unknown> = {};
            if (opts.content) updates.label = opts.content;
            if (opts.type) updates.memory_type = opts.type;
            if (opts.pin) updates.is_pinned = true;
            if (opts.unpin) updates.is_pinned = false;
            if (opts.heat) updates.current_heat = parseFloat(opts.heat);
            if (Object.keys(updates).length === 0) { console.error("No fields to update."); return; }
            try {
              const res = await sulcusMem.update_memory(id, updates as any);
              if (opts.json) { console.log(JSON.stringify(res, null, 2)); }
              else { console.log(`Updated memory ${id} (${Object.keys(updates).join(", ")})`); }
            } catch (e: unknown) { console.error(`Error: ${e instanceof Error ? e.message : e}`); }
          });

        // --- openclaw sulcus delete ---
        sulcusCmd.command("delete <id>")
          .description("Delete a memory")
          .option("--no-train", "Don't train SIVU to reject similar")
          .option("--json", "Machine-readable JSON output")
          .action(async (id: string, opts: { train?: boolean; json?: boolean }) => {
            if (!isAvailable || !sulcusMem) { console.error("Sulcus not connected."); return; }
            try {
              const train = opts.train !== false;
              await sulcusMem.delete_memory(id, train);
              if (opts.json) { console.log(JSON.stringify({ deleted: id, trained: train })); }
              else { console.log(`Deleted memory ${id}${train ? " (trained SIVU)" : ""}`); }
            } catch (e: unknown) { console.error(`Error: ${e instanceof Error ? e.message : e}`); }
          });

        // --- openclaw sulcus export ---
        sulcusCmd.command("export")
          .description("Export all memories as Markdown")
          .action(async () => {
            if (!isAvailable || !sulcusMem) { console.error("Sulcus not connected."); return; }
            try {
              const md = await sulcusMem.export_markdown();
              console.log(md);
            } catch (e: unknown) { console.error(`Error: ${e instanceof Error ? e.message : e}`); }
          });

        // --- openclaw sulcus import ---
        sulcusCmd.command("import <file>")
          .description("Import memories from a Markdown file")
          .action(async (file: string) => {
            if (!isAvailable || !sulcusMem) { console.error("Sulcus not connected."); return; }
            try {
              const { readFileSync } = require("fs") as { readFileSync: (p: string, e: string) => string };
              const text = readFileSync(file, "utf-8");
              const res = await sulcusMem.import_markdown(text);
              console.log(JSON.stringify(res, null, 2));
            } catch (e: unknown) { console.error(`Error: ${e instanceof Error ? e.message : e}`); }
          });

        // --- openclaw sulcus consolidate ---
        sulcusCmd.command("consolidate")
          .description("Run dream/consolidation on cold memories")
          .option("--min-heat <value>", "Heat threshold (0.0-1.0)", "0.1")
          .option("--json", "Machine-readable JSON output")
          .action(async (opts: { minHeat: string; json?: boolean }) => {
            if (!isAvailable || !sulcusMem) { console.error("Sulcus not connected."); return; }
            try {
              const res = await sulcusMem.consolidate(parseFloat(opts.minHeat));
              if (opts.json) { console.log(JSON.stringify(res, null, 2)); }
              else { console.log("Consolidation complete."); console.log(JSON.stringify(res, null, 2)); }
            } catch (e: unknown) { console.error(`Error: ${e instanceof Error ? e.message : e}`); }
          });

        // --- openclaw sulcus hot ---
        sulcusCmd.command("hot")
          .description("Show hottest memories")
          .option("-n, --limit <n>", "Max results", "10")
          .option("--json", "Machine-readable JSON output")
          .action(async (opts: { limit: string; json?: boolean }) => {
            if (!isAvailable || !sulcusMem) { console.error("Sulcus not connected."); return; }
            try {
              const res = await sulcusMem.list_hot_nodes(parseInt(opts.limit, 10));
              const nodes = res?.nodes ?? [];
              if (opts.json) { console.log(JSON.stringify(nodes, null, 2)); return; }
              if (nodes.length === 0) { console.log("No hot nodes."); return; }
              for (const n of nodes) {
                const heat = typeof n.current_heat === "number" ? ((n.current_heat as number) * 100).toFixed(0) + "%" : "?";
                const label = ((n.label ?? n.pointer_summary ?? "") as string).slice(0, 100);
                console.log(`[${heat}] ${label}`);
              }
            } catch (e: unknown) { console.error(`Error: ${e instanceof Error ? e.message : e}`); }
          });

        logger.info("sulcus: registered CLI commands (openclaw sulcus <cmd>)");
      }, {
        commands: ["sulcus"],
        descriptors: [{
          name: "sulcus",
          description: "Sulcus memory management \u2014 status, search, add, get, list, update, delete, export, import, consolidate, hot",
          hasSubcommands: true,
        }],
      });
    } else {
      logger.info("sulcus: registerCli not available \u2014 CLI commands skipped");
    }

    // Fire-and-forget first-install history import
    if (isAvailable && sulcusMem instanceof SulcusCloudClient) {
      importOpenClawHistory(sulcusMem, logger).catch((e: unknown) => {
        logger.warn(`sulcus: history import failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    }
  }
};

export default sulcusPlugin;
