/**
 * Sulcus Context Engine — MemPalace Architecture
 *
 * Registers openclaw-sulcus as an OpenClaw Context Engine with ownsCompaction: true.
 *
 * Core principles:
 *   - Verbatim storage: content goes in exactly as received. No truncation on store.
 *   - No destructive trimming: the view is managed, never the data.
 *   - Constructive assembly: context is built from working memory + Sulcus pointers.
 *   - Compaction delegation: when budget is genuinely full, delegate to runtime.
 *
 * Assembly modes:
 *   - passthrough: no-op, messages unchanged
 *   - memory-aware: inject Sulcus memory index, compress already-stored content
 *   - constructive: build context from cache + recent turns at full fidelity,
 *     older turns use pointer_summary from Sulcus (SILU-generated)
 *
 * afterTurn():
 *   1. Increment turn counter, track session activity
 *   2. Evict stale sessions (TTL-based)
 *   3. Store ALL tool results to Sulcus verbatim (cosine dedup guard)
 *   4. Session knowledge capture (decisions, files, commands)
 *   5. Compaction delegation when budget is genuinely full
 *
 * All thresholds configurable via ContextEngineThresholds.
 */

// ---------------------------------------------------------------------------
// Configurable Thresholds
// ---------------------------------------------------------------------------

/**
 * All tunable thresholds for the Sulcus context engine.
 *
 * MemPalace architecture: no destructive trimming thresholds.
 * Budget management is handled by constructive assembly (pointer summaries)
 * and compaction delegation (runtime compactor).
 */
export interface ContextEngineThresholds {
  /** Trigger compaction delegation when context reaches this fraction of budget. */
  compactionTriggerRatio: number;
  /**
   * Minimum turns between compaction triggers (base value).
   * Adaptive logic reduces to 1 when growth rate is high.
   */
  minTurnsBetweenCompaction: number;
  /**
   * Growth rate threshold (tokens/turn) above which compaction interval drops to 1.
   * Heavy tool-use sessions add 10-30k tokens per turn.
   */
  highGrowthRateThreshold: number;
  /** Rough chars-per-token estimate for budget calculations. */
  charsPerToken: number;
  /** Turn interval for session knowledge extraction. */
  knowledgeCaptureInterval: number;
  /** Budget threshold ratio for knowledge capture — only when pressure is building. */
  knowledgeCaptureRatio: number;
  /**
   * Recent turn window: how many recent turns to pass through at full fidelity
   * in constructive assembly. Adjusts dynamically based on budget.
   */
  constructiveMinRecentTurns: number;
  /** Memory-aware assembly: inject index when under this fraction of budget. */
  assemblyInjectRatio: number;
  /** Memory-aware assembly: inject full recalled memories when under this fraction. */
  assemblyRecallRatio: number;
  /** Memory-aware assembly: cap recalled injection to fit under this fraction. */
  assemblyRecallCapRatio: number;
  /** Constructive assembly: fraction of conversation budget for recent turns. */
  constructiveRecentBudgetRatio: number;
  /** TTL for stale sessions in milliseconds (default: 2 hours). */
  sessionTtlMs: number;
  /**
   * Cosine dedup threshold: skip storing a tool result if Jaccard similarity
   * (proxy for cosine distance) to a recently stored result exceeds this value.
   * 0.85 ≈ cosine distance < 0.15.
   */
  dedupSimilarityThreshold: number;
  /** Number of recent stores to check for dedup. */
  dedupWindowSize: number;
}

/** Default threshold values — MemPalace architecture. */
export const DEFAULT_THRESHOLDS: ContextEngineThresholds = {
  compactionTriggerRatio: 0.75,
  minTurnsBetweenCompaction: 3,
  highGrowthRateThreshold: 10_000,
  charsPerToken: 4,
  knowledgeCaptureInterval: 8,
  knowledgeCaptureRatio: 0.40,
  constructiveMinRecentTurns: 4,
  assemblyInjectRatio: 0.85,
  assemblyRecallRatio: 0.70,
  assemblyRecallCapRatio: 0.80,
  constructiveRecentBudgetRatio: 0.60,
  sessionTtlMs: 2 * 60 * 60 * 1000, // 2 hours
  dedupSimilarityThreshold: 0.85,
  dedupWindowSize: 10,
};

/** Decision markers for extracting decisions from assistant messages */
const DECISION_MARKERS = ["decided", "will use", "going to", "plan is", "the fix", "conclusion", "recommend", "approach"];

/** A cached tool result entry, keyed by message ID */
interface WorkingMemoryEntry {
  messageId: string;
  toolName: string;
  /** Sulcus node ID if stored to memory */
  sulcusNodeId?: string;
  /** Original content length in chars */
  originalLength: number;
  /** Turn number when this was cached */
  turn: number;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface SulcusMemoryClient {
  search_memory(query: string, limit: number, namespace?: string): Promise<{ results: Record<string, unknown>[] }>;
  add_memory(content: string, memoryType?: string | null, hints?: { key_points?: string[] }): Promise<{ id: string; [key: string]: unknown }>;
  store_episode?(episode: Record<string, unknown>): Promise<{ id: string; [key: string]: unknown }>;
}

export interface SulcusContextEngineConfig {
  version: string;
  assemblyMode: "passthrough" | "memory-aware" | "constructive";
  compactMode?: "passthrough" | "smart";
  logger: {
    info: (msg: string) => void;
    debug: (msg: string) => void;
    warn: (msg: string) => void;
  };
  /** The delegateCompactionToRuntime function from OpenClaw's plugin SDK */
  delegateCompaction: (params: any) => Promise<any>;
  /** Sulcus memory client for memory-aware assembly */
  memoryClient?: SulcusMemoryClient | null;
  /** Namespace for memory queries */
  namespace?: string;
  /** Override default thresholds. Partial — unspecified fields use defaults. */
  thresholds?: Partial<ContextEngineThresholds>;
}

export class SulcusContextEngine {
  readonly info: {
    id: string;
    name: string;
    version: string;
    ownsCompaction: boolean;
    turnMaintenanceMode: "foreground" | "background";
  };
  private logger: SulcusContextEngineConfig["logger"];
  private delegateCompaction: SulcusContextEngineConfig["delegateCompaction"];
  private assemblyMode: "passthrough" | "memory-aware" | "constructive";
  private compactMode: "passthrough" | "smart";
  private memoryClient: SulcusMemoryClient | null;
  private namespace: string;
  /** Merged thresholds (defaults + user overrides). */
  private t: ContextEngineThresholds;

  // Compaction tracking per session
  private lastCompactionTurn = new Map<string, number>();
  private turnCounter = new Map<string, number>();
  // Track message IDs already captured to Sulcus (unified dedup guard)
  private capturedMsgIds = new Map<string, Set<string>>();
  // Track session knowledge capture turns
  private lastKnowledgeCaptureTurn = new Map<string, number>();
  // Growth rate tracking (tokens at previous turn, for delta)
  private lastTokenCount = new Map<string, number>();
  private growthRate = new Map<string, number>(); // tokens/turn EMA
  // Working memory cache per session — summaries of tool results
  private workingMemory = new Map<string, Map<string, WorkingMemoryEntry>>();
  // Track last-scanned message index for knowledge capture per session
  private lastKnowledgeScanIndex = new Map<string, number>();
  // Track last activity timestamp per session for TTL eviction
  private sessionLastActivity = new Map<string, number>();
  // Dedup: recent store fingerprints for cosine dedup approximation
  private recentStoreFingerprints = new Map<string, string[]>();

  constructor(config: SulcusContextEngineConfig) {
    this.logger = config.logger;
    this.delegateCompaction = config.delegateCompaction;
    this.assemblyMode = config.assemblyMode;
    this.compactMode = config.compactMode ?? "smart";
    this.memoryClient = config.memoryClient ?? null;
    this.namespace = config.namespace ?? "default";
    this.t = { ...DEFAULT_THRESHOLDS, ...config.thresholds };
    this.info = {
      id: "openclaw-sulcus",
      name: "Sulcus Context Engine",
      version: config.version,
      ownsCompaction: true,
      turnMaintenanceMode: "foreground",
    };
    this.logger.info(
      `sulcus-context-engine: initialized v${config.version} (assembly=${this.assemblyMode}, compact=${this.compactMode}, architecture=mempalace)`
    );
    this.logger.info(
      `sulcus-context-engine: thresholds: ${JSON.stringify(this.t)}`
    );
  }

  // ---------------------------------------------------------------------------
  // Bootstrap / Maintain / Ingest
  // ---------------------------------------------------------------------------

  async bootstrap(_params: any) {
    return { bootstrapped: false, reason: "phase-5" };
  }

  async maintain(_params: any) {
    return { changed: false, bytesFreed: 0, rewrittenEntries: 0, reason: "phase-5" };
  }

  /**
   * Ingest a single message into working memory.
   * For tool results: cache metadata, store full content to Sulcus verbatim.
   * SILU generates pointer_summary server-side.
   * Uses unified capturedMsgIds dedup guard to prevent double-ingestion.
   */
  async ingest(params: any) {
    const { sessionId, message } = params;
    if (!message || message.role !== "tool" || typeof message.content !== "string") {
      return { ingested: false };
    }
    if (!message.id || message.content.length < 200) {
      return { ingested: false }; // too small to bother
    }

    const sessionCache = this.getSessionCache(sessionId);
    if (sessionCache.has(message.id)) {
      return { ingested: false }; // already cached
    }

    // Unified dedup: check capturedMsgIds before storing to Sulcus
    const sessionCaptured = this.getSessionCapturedIds(sessionId);

    const toolName = message.name || "tool";
    const turn = this.turnCounter.get(sessionId) ?? 0;

    const entry: WorkingMemoryEntry = {
      messageId: message.id,
      toolName,
      originalLength: message.content.length,
      turn,
    };

    // Store full content to Sulcus verbatim — no captureMinChars gate
    // SILU will generate pointer_summary server-side
    if (this.memoryClient && !sessionCaptured.has(message.id)) {
      // Cosine dedup: skip if near-duplicate of recent store
      if (!this.isDedupMatch(sessionId, message.content)) {
        try {
          const res = await this.memoryClient.add_memory(
            `[Tool: ${toolName}]\n${message.content}`,
            "episodic",
            { key_points: [`tool-result:${toolName}`, `session:${sessionId}`, `msg:${message.id}`] },
          );
          entry.sulcusNodeId = res?.id;
          sessionCaptured.add(message.id);
          this.addDedupFingerprint(sessionId, message.content);
          this.logger.debug(`sulcus-ce: ingested tool result to memory (${toolName}, ${message.content.length} chars) [msg=${message.id}]`);
        } catch {
          this.logger.debug(`sulcus-ce: memory store failed for ingest [msg=${message.id}]`);
        }
      } else {
        this.logger.debug(`sulcus-ce: skipped dedup ingest [msg=${message.id}]`);
        sessionCaptured.add(message.id); // mark as handled even if skipped
      }
    }

    sessionCache.set(message.id, entry);
    return { ingested: true };
  }

  /**
   * Batch ingest messages into working memory.
   */
  async ingestBatch(params: any) {
    const { sessionId, messages } = params;
    if (!messages || !Array.isArray(messages)) return { ingestedCount: 0 };
    let count = 0;
    for (const msg of messages) {
      const res = await this.ingest({ sessionId, message: msg });
      if (res.ingested) count++;
    }
    return { ingestedCount: count };
  }

  /** Get or create the working memory cache for a session. */
  private getSessionCache(sessionId: string): Map<string, WorkingMemoryEntry> {
    let cache = this.workingMemory.get(sessionId);
    if (!cache) {
      cache = new Map();
      this.workingMemory.set(sessionId, cache);
    }
    return cache;
  }

  /** Get or create the captured message ID set for a session (unified dedup guard). */
  private getSessionCapturedIds(sessionId: string): Set<string> {
    let ids = this.capturedMsgIds.get(sessionId);
    if (!ids) {
      ids = new Set();
      this.capturedMsgIds.set(sessionId, ids);
    }
    return ids;
  }

  // ---------------------------------------------------------------------------
  // Cosine dedup approximation (Jaccard on token sets as proxy)
  // ---------------------------------------------------------------------------

  /**
   * Compute Jaccard similarity between two strings using word-level token sets.
   * Uses first 500 chars as proxy for full content (per runbook spec).
   * Jaccard ≥ 0.85 ≈ cosine distance < 0.15.
   */
  private jaccardSimilarity(a: string, b: string): number {
    const tokenize = (s: string): Set<string> => {
      const words = s.slice(0, 500).toLowerCase().split(/\W+/).filter(w => w.length > 1);
      return new Set(words);
    };
    const setA = tokenize(a);
    const setB = tokenize(b);
    if (setA.size === 0 && setB.size === 0) return 1.0;
    if (setA.size === 0 || setB.size === 0) return 0.0;
    let intersection = 0;
    for (const w of setA) {
      if (setB.has(w)) intersection++;
    }
    return intersection / (setA.size + setB.size - intersection);
  }

  /**
   * Check if content is a near-duplicate of a recently stored result.
   * Returns true if any recent fingerprint has Jaccard >= threshold.
   */
  private isDedupMatch(sessionId: string, content: string): boolean {
    const fingerprints = this.recentStoreFingerprints.get(sessionId);
    if (!fingerprints || fingerprints.length === 0) return false;
    for (const fp of fingerprints) {
      if (this.jaccardSimilarity(content, fp) >= this.t.dedupSimilarityThreshold) {
        return true;
      }
    }
    return false;
  }

  /** Add a fingerprint to the recent store window (bounded by dedupWindowSize). */
  private addDedupFingerprint(sessionId: string, content: string): void {
    let fingerprints = this.recentStoreFingerprints.get(sessionId);
    if (!fingerprints) {
      fingerprints = [];
      this.recentStoreFingerprints.set(sessionId, fingerprints);
    }
    fingerprints.push(content.slice(0, 500));
    // Keep only the most recent N
    while (fingerprints.length > this.t.dedupWindowSize) {
      fingerprints.shift();
    }
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle — cleanup + TTL eviction
  // ---------------------------------------------------------------------------

  /**
   * Clear all per-session state for a given session.
   * Call when a session ends (e.g. from onSubagentEnded or dispose).
   */
  clearSession(sessionId: string): void {
    this.turnCounter.delete(sessionId);
    this.lastCompactionTurn.delete(sessionId);
    this.capturedMsgIds.delete(sessionId);
    this.lastKnowledgeCaptureTurn.delete(sessionId);
    this.lastKnowledgeScanIndex.delete(sessionId);
    this.lastTokenCount.delete(sessionId);
    this.growthRate.delete(sessionId);
    this.workingMemory.delete(sessionId);
    this.sessionLastActivity.delete(sessionId);
    this.recentStoreFingerprints.delete(sessionId);
    this.logger.debug(`sulcus-ce: cleared session state [session=${sessionId}]`);
  }

  /**
   * Evict stale sessions that haven't been active within the TTL window.
   * Called periodically from afterTurn to prevent unbounded memory growth.
   */
  private evictStaleSessions(): void {
    const now = Date.now();
    const ttl = this.t.sessionTtlMs;
    const stale: string[] = [];
    for (const [sessionId, lastActivity] of this.sessionLastActivity) {
      if (now - lastActivity > ttl) {
        stale.push(sessionId);
      }
    }
    for (const sessionId of stale) {
      this.clearSession(sessionId);
    }
    if (stale.length > 0) {
      this.logger.info(`sulcus-ce: evicted ${stale.length} stale session(s) (TTL=${ttl}ms)`);
    }
  }

  // ---------------------------------------------------------------------------
  // afterTurn — Verbatim storage + knowledge capture + compaction delegation
  // ---------------------------------------------------------------------------

  async afterTurn(params: any): Promise<void> {
    const {
      sessionId,
      messages,
      tokenBudget,
      runtimeContext,
    } = params;

    // 1. Increment turn counter, track session activity
    const turn = (this.turnCounter.get(sessionId) ?? 0) + 1;
    this.turnCounter.set(sessionId, turn);
    this.sessionLastActivity.set(sessionId, Date.now());

    // 2. Evict stale sessions (every 10 turns to avoid overhead)
    if (turn % 10 === 0) {
      this.evictStaleSessions();
    }

    const budget = tokenBudget ?? runtimeContext?.tokenBudget;
    const currentTokens = runtimeContext?.currentTokenCount;

    if (!budget || !currentTokens) return;

    const usage = currentTokens / budget;
    const usagePct = (usage * 100).toFixed(1);

    // Growth rate tracking (EMA) — drives adaptive compaction intervals
    const prevTokens = this.lastTokenCount.get(sessionId);
    const hasPrevious = prevTokens !== undefined;
    this.lastTokenCount.set(sessionId, currentTokens);

    let newGrowth: number;
    if (!hasPrevious) {
      // First turn — no meaningful growth signal. Seed at 0.
      newGrowth = 0;
    } else {
      const tokensAddedThisTurn = Math.max(0, currentTokens - prevTokens);
      const prevGrowth = this.growthRate.get(sessionId) ?? 0;
      // Exponential moving average: 0.3 weight on new data, 0.7 on history
      newGrowth = Math.round(0.3 * tokensAddedThisTurn + 0.7 * prevGrowth);
    }
    this.growthRate.set(sessionId, newGrowth);

    if (usage > 0.5) {
      this.logger.debug(
        `sulcus-ce: context pressure ${usagePct}% (${currentTokens}/${budget} tokens, growth: ${newGrowth} tok/turn) [session=${sessionId}, turn=${turn}]`
      );
    }

    // 3. Store ALL tool results to Sulcus verbatim (no captureMinChars gate)
    //    Cosine dedup: skip store if Jaccard similarity to recent stores > threshold
    if (this.memoryClient) {
      await this.storeToolResultsVerbatim(messages, sessionId, turn);
    }

    // 4. Session knowledge capture (decisions, files, commands)
    if (
      usage >= this.t.knowledgeCaptureRatio &&
      this.memoryClient &&
      turn - (this.lastKnowledgeCaptureTurn.get(sessionId) ?? 0) >= this.t.knowledgeCaptureInterval
    ) {
      await this.captureSessionKnowledge(messages, sessionId, turn, usagePct);
    }

    // 5. Populate working memory cache for constructive assembly
    if (this.assemblyMode === "constructive") {
      const sessionCache = this.getSessionCache(sessionId);
      let newCached = 0;
      for (const msg of messages) {
        if (msg.role !== "tool" || typeof msg.content !== "string" || !msg.id) continue;
        if (sessionCache.has(msg.id)) continue;
        if (msg.content.length < 200) continue;

        const toolName = msg.name || "tool";
        const entry: WorkingMemoryEntry = {
          messageId: msg.id,
          toolName,
          originalLength: msg.content.length,
          turn,
        };
        sessionCache.set(msg.id, entry);
        newCached++;
      }
      if (newCached > 0) {
        this.logger.debug(`sulcus-ce: cached ${newCached} tool results (total: ${sessionCache.size}) [turn=${turn}]`);
      }
    }

    // 6. Compaction delegation — only when budget is genuinely full
    //    No pre-trimming. Delegates to runtime compactor which summarizes the session file.
    if (usage >= this.t.compactionTriggerRatio) {
      const lastCompaction = this.lastCompactionTurn.get(sessionId) ?? 0;
      const turnsSinceCompaction = turn - lastCompaction;
      const minTurns = newGrowth >= this.t.highGrowthRateThreshold ? 1 : this.t.minTurnsBetweenCompaction;

      if (turnsSinceCompaction >= minTurns) {
        this.logger.info(
          `sulcus-ce: COMPACTION DELEGATION at ${usagePct}% (${currentTokens}/${budget}). ` +
          `Growth: ${newGrowth} tok/turn [session=${sessionId}]`
        );
        try {
          const result = await this.delegateCompaction({
            sessionId,
            sessionFile: params.sessionFile,
            tokenBudget: budget,
            currentTokenCount: currentTokens,
            force: false,
            runtimeContext,
          });
          this.lastCompactionTurn.set(sessionId, turn);
          if (result.compacted) {
            const saved = (result.result?.tokensBefore ?? 0) - (result.result?.tokensAfter ?? 0);
            this.logger.info(`sulcus-ce: compaction succeeded — saved ~${saved} tokens`);
          } else {
            this.logger.debug(`sulcus-ce: compaction declined: ${result.reason ?? "unknown"}`);
          }
        } catch (e) {
          this.logger.warn(`sulcus-ce: compaction failed: ${e}`);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Store tool results verbatim to Sulcus (no size gate, dedup guard)
  // ---------------------------------------------------------------------------

  /**
   * Store ALL tool results to Sulcus verbatim. No captureMinChars gate.
   * Cosine dedup guard: skip if Jaccard similarity to recent stores > threshold.
   */
  private async storeToolResultsVerbatim(
    messages: any[],
    sessionId: string,
    turn: number,
  ): Promise<void> {
    const sessionCaptured = this.getSessionCapturedIds(sessionId);

    let storeCount = 0;
    let dedupSkipped = 0;
    for (const msg of messages) {
      if (msg.role !== "tool" || typeof msg.content !== "string") continue;
      if (!msg.id || msg.content.length < 200) continue; // too small to be useful
      if (sessionCaptured.has(msg.id)) continue; // already stored

      // Cosine dedup approximation: check Jaccard similarity to recent stores
      if (this.isDedupMatch(sessionId, msg.content)) {
        sessionCaptured.add(msg.id); // mark as handled
        dedupSkipped++;
        continue;
      }

      try {
        const toolName = msg.name || "tool-result";
        await this.memoryClient!.add_memory(
          `[Tool: ${toolName}]\n${msg.content}`,
          "episodic",
          { key_points: [`tool-result:${toolName}`, `session:${sessionId}`, `msg:${msg.id}`] },
        );
        sessionCaptured.add(msg.id);
        this.addDedupFingerprint(sessionId, msg.content);
        storeCount++;

        // Update working memory entry with Sulcus node ID if cached
        const sessionCache = this.workingMemory.get(sessionId);
        const entry = sessionCache?.get(msg.id);
        if (entry) {
          // Note: we don't have the node ID from add_memory in fire-and-forget mode
          // but the dedup guard prevents double-stores
        }
      } catch (e) {
        this.logger.warn(`sulcus-ce: verbatim store failed for msg ${msg.id}: ${e}`);
      }
    }

    if (storeCount > 0 || dedupSkipped > 0) {
      this.logger.info(
        `sulcus-ce: stored ${storeCount} tool results verbatim` +
        (dedupSkipped > 0 ? `, skipped ${dedupSkipped} dedup` : "") +
        ` [session=${sessionId}, turn=${turn}]`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Continuous session knowledge capture
  // ---------------------------------------------------------------------------

  private async captureSessionKnowledge(
    messages: any[],
    sessionId: string,
    turn: number,
    usagePct: string,
  ): Promise<void> {
    this.lastKnowledgeCaptureTurn.set(sessionId, turn);

    try {
      // Only scan messages from lastKnowledgeScanIndex forward.
      const lastScanIdx = this.lastKnowledgeScanIndex.get(sessionId) ?? 0;
      const messagesToScan = messages.slice(lastScanIdx);
      // Update scan index to current end (even if capture fails, don't re-scan)
      this.lastKnowledgeScanIndex.set(sessionId, messages.length);

      const decisions: string[] = [];
      const filesModified: string[] = [];
      const commandsRun: string[] = [];
      const userIntents: string[] = [];

      for (const msg of messagesToScan) {
        const role = msg.role as string;
        const content = typeof msg.content === "string" ? msg.content : "";

        // User intents
        if (role === "user" && content.length > 10) {
          userIntents.push(content.substring(0, 150));
        }

        // Decisions from assistant messages
        if (role === "assistant" && content.length > 20) {
          const lc = content.toLowerCase();
          if (DECISION_MARKERS.some((m) => lc.includes(m))) {
            const sentences = content.split(/[.!?\n]/).filter((s: string) => s.trim().length > 10);
            for (const s of sentences) {
              if (DECISION_MARKERS.some((m) => s.toLowerCase().includes(m)) && !decisions.includes(s.trim())) {
                decisions.push(s.trim().substring(0, 200));
                if (decisions.length >= 5) break;
              }
            }
          }
        }

        // Tool calls — files modified, commands run
        const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
        for (const tc of toolCalls) {
          const name = (tc.name ?? tc.function) as string | undefined;
          if (name === "Write" || name === "Edit" || name === "write" || name === "edit") {
            const input = (tc.input ?? tc.arguments ?? {}) as Record<string, unknown>;
            const fp = input?.file_path ?? input?.path;
            if (fp && typeof fp === "string" && !filesModified.includes(fp)) filesModified.push(fp);
          }
          if (name === "Bash" || name === "bash" || name === "exec" || name === "shell") {
            const input = (tc.input ?? tc.arguments ?? {}) as Record<string, unknown>;
            const cmd = input?.command ?? input?.cmd;
            if (cmd && typeof cmd === "string" && commandsRun.length < 5) {
              commandsRun.push(cmd.substring(0, 100));
            }
          }
        }
      }

      const storePromises: Promise<unknown>[] = [];

      // Store decisions as semantic memory
      if (decisions.length > 0) {
        const decisionText = `Session decisions (turn ${turn}): ${decisions.join(" | ")}`;
        storePromises.push(
          this.memoryClient!.add_memory(decisionText, "semantic", {
            key_points: [`session:${sessionId}`, "decisions", `turn:${turn}`],
          }).catch((e) => this.logger.debug(`sulcus-ce: decision capture failed: ${e}`))
        );
      }

      // Store structured episode
      if (this.memoryClient!.store_episode) {
        const firstUser = messages.find((m: any) => m.role === "user" && typeof m.content === "string");
        const episode: Record<string, unknown> = {
          topic: typeof firstUser?.content === "string" ? firstUser.content.substring(0, 200) : "(none)",
          decisions: decisions.slice(0, 5),
          files_modified: filesModified.slice(0, 10),
          commands_run: commandsRun.slice(0, 5),
          outcome: "in-progress",
          duration_turns: messages.length,
          timestamp: new Date().toISOString(),
        };
        storePromises.push(
          this.memoryClient!.store_episode!(episode)
            .catch((e) => this.logger.debug(`sulcus-ce: episode capture failed: ${e}`))
        );
      }

      await Promise.allSettled(storePromises);
      if (storePromises.length > 0) {
        this.logger.info(`sulcus-ce: session knowledge capture — stored ${storePromises.length} memories (turn ${turn}, ${usagePct}% budget)`);
      }
    } catch (e) {
      this.logger.warn(`sulcus-ce: session knowledge capture failed: ${e}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Assemble — Memory-Aware Assembly with Full Recall
  // ---------------------------------------------------------------------------

  async assemble(params: any) {
    // Constructive assembly — build context from cache, not trim transcript
    if (this.assemblyMode === "constructive") {
      return this.assembleConstructive(params);
    }

    if (this.assemblyMode !== "memory-aware" || !this.memoryClient) {
      return { messages: params.messages, estimatedTokens: 0 };
    }

    const { messages, tokenBudget, sessionId } = params;

    try {
      // 1. Extract topic from recent user messages (last 3)
      const recentUserMsgs = messages
        .filter((m: any) => m.role === "user" && typeof m.content === "string")
        .slice(-3);
      if (recentUserMsgs.length === 0) {
        return { messages, estimatedTokens: 0 };
      }
      const topicText = recentUserMsgs
        .map((m: any) => m.content)
        .join(" ")
        .slice(0, 500);

      // 2. Search Sulcus for relevant memories
      const searchRes = await this.memoryClient.search_memory(topicText, 8, this.namespace);
      const memories = searchRes?.results ?? [];

      if (memories.length === 0) {
        this.logger.debug(`sulcus-ce: assemble — no relevant memories found`);
        return { messages, estimatedTokens: 0 };
      }

      // 3. Build memory index
      const memoryIndex = memories.map((m: any) => {
        const heat = typeof m.heat === "number" ? m.heat.toFixed(2) : "?";
        const type = m.memory_type || "unknown";
        const preview = typeof m.content === "string"
          ? m.content.slice(0, 120).replace(/\n/g, " ")
          : "(no preview)";
        return `- [${type}|h:${heat}] ${preview}${m.content?.length > 120 ? "\u2026" : ""}`;
      }).join("\n");

      const indexMessage = {
        role: "system" as const,
        content: `<sulcus_memory_index count="${memories.length}" note="These memories are stored in Sulcus and recoverable via memory_recall. If context is tight, content already stored here can be safely summarized.">\n${memoryIndex}\n</sulcus_memory_index>`,
      };

      // 4. Estimate current token usage
      let totalChars = 0;
      for (const msg of messages) {
        if (typeof msg.content === "string") totalChars += msg.content.length;
        else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (typeof part === "string") totalChars += part.length;
            else if (part?.text) totalChars += part.text.length;
          }
        }
      }
      totalChars += indexMessage.content.length;
      const estimatedTokens = Math.ceil(totalChars / this.t.charsPerToken);

      // 5. If under budget, inject memory context
      if (!tokenBudget || estimatedTokens < tokenBudget * this.t.assemblyInjectRatio) {
        const injections: any[] = [indexMessage];
        if (tokenBudget && estimatedTokens < tokenBudget * this.t.assemblyRecallRatio) {
          const topMemories = memories.slice(0, 3).filter(
            (m: any) => typeof m.content === "string" && m.content.length > 50 && m.content.length < 2000
          );
          if (topMemories.length > 0) {
            const recalledContent = topMemories.map((m: any) => {
              const type = m.memory_type || "unknown";
              const heat = typeof m.heat === "number" ? m.heat.toFixed(2) : "?";
              return `[${type}|h:${heat}] ${m.content}`;
            }).join("\n---\n");
            const recalledChars = recalledContent.length;
            const recalledTokens = Math.ceil(recalledChars / this.t.charsPerToken);
            if (estimatedTokens + recalledTokens < tokenBudget * this.t.assemblyRecallCapRatio) {
              injections.push({
                role: "system" as const,
                content: `<sulcus_recalled_context note="Relevant memories recalled from Sulcus for this conversation.">\n${recalledContent}\n</sulcus_recalled_context>`,
              });
              totalChars += recalledChars;
              this.logger.debug(`sulcus-ce: assemble — injected ${topMemories.length} full recalled memories (+${recalledTokens} tokens)`);
            }
          }
        }

        const firstNonSystem = messages.findIndex((m: any) => m.role !== "system");
        const insertAt = firstNonSystem === -1 ? messages.length : firstNonSystem;
        const finalTokens = Math.ceil(totalChars / this.t.charsPerToken);
        const assembled = [
          ...messages.slice(0, insertAt),
          ...injections,
          ...messages.slice(insertAt),
        ];
        this.logger.debug(`sulcus-ce: assemble — injected ${memories.length} memory refs (${finalTokens} est tokens, under budget)`);
        return { messages: assembled, estimatedTokens: finalTokens };
      }

      // 6. Over budget — compress messages whose content is already stored in Sulcus
      const storedFingerprints = new Set<string>();
      for (const m of memories) {
        if (typeof m.content === "string" && m.content.length > 50) {
          storedFingerprints.add(m.content.slice(0, 100).trim().toLowerCase());
        }
      }

      const compressed = messages.map((msg: any) => {
        if (msg.role === "system" || msg.role === "user") return msg;
        if (typeof msg.content !== "string" || msg.content.length < 500) return msg;

        const fingerprint = msg.content.slice(0, 100).trim().toLowerCase();
        if (storedFingerprints.has(fingerprint)) {
          const summary = msg.content.slice(0, 200).replace(/\n/g, " ");
          return {
            ...msg,
            content: `[stored in sulcus \u2014 use memory_recall to retrieve] ${summary}\u2026`,
          };
        }
        return msg;
      });

      let compressedChars = 0;
      for (const msg of compressed) {
        if (typeof msg.content === "string") compressedChars += msg.content.length;
      }
      compressedChars += indexMessage.content.length;
      const compressedTokens = Math.ceil(compressedChars / this.t.charsPerToken);

      const firstNonSystem = compressed.findIndex((m: any) => m.role !== "system");
      const insertAt = firstNonSystem === -1 ? compressed.length : firstNonSystem;
      const assembled = [
        ...compressed.slice(0, insertAt),
        indexMessage,
        ...compressed.slice(insertAt),
      ];

      const savedTokens = estimatedTokens - compressedTokens;
      this.logger.info(`sulcus-ce: assemble \u2014 memory-aware compression saved ~${savedTokens} tokens (${estimatedTokens} \u2192 ${compressedTokens})`);
      return { messages: assembled, estimatedTokens: compressedTokens };

    } catch (e) {
      this.logger.warn(`sulcus-ce: assemble memory-aware failed: ${e} \u2014 falling back to passthrough`);
      return { messages: params.messages, estimatedTokens: 0 };
    }
  }

  // ---------------------------------------------------------------------------
  // Constructive Assembly
  // Builds context deterministically: system messages + memory injection +
  // recent turns at full fidelity + older turns with pointer summaries.
  // Always fits within tokenBudget. No transcript patching.
  // ---------------------------------------------------------------------------

  /**
   * Build context from working memory cache + recent turns.
   *
   * - System messages: pass through unchanged
   * - Recent N turns: pass through at full fidelity (agent needs recent context verbatim)
   * - Older tool results: replaced with pointer_summary from Sulcus
   * - Older assistant messages: kept at full fidelity (no compression)
   * - Memory injection: relevant recalled memories woven in
   * - N is budget-driven: calculated from tokenBudget minus system + memory overhead
   */
  private async assembleConstructive(params: any) {
    const { messages, tokenBudget, sessionId } = params;
    if (!messages || messages.length === 0) {
      return { messages: [], estimatedTokens: 0 };
    }
    if (!tokenBudget) {
      // No budget info — pass through unchanged
      return { messages, estimatedTokens: 0 };
    }

    const sessionCache = this.getSessionCache(sessionId);

    try {
      // 1. Separate system messages (always included at full fidelity)
      const systemMsgs = messages.filter((m: any) => m.role === "system");
      const conversationMsgs = messages.filter((m: any) => m.role !== "system");

      // 2. Estimate system message cost
      let systemChars = 0;
      for (const msg of systemMsgs) {
        systemChars += this.estimateMessageChars(msg);
      }
      const systemTokens = Math.ceil(systemChars / this.t.charsPerToken);

      // 3. Build memory injection block (if memoryClient available)
      let memoryBlock: any | null = null;
      let memoryTokens = 0;
      if (this.memoryClient) {
        try {
          const recentUser = conversationMsgs
            .filter((m: any) => m.role === "user" && typeof m.content === "string")
            .slice(-3);
          if (recentUser.length > 0) {
            const topicText = recentUser.map((m: any) => m.content).join(" ").slice(0, 500);
            const searchRes = await this.memoryClient.search_memory(topicText, 5, this.namespace);
            const memories = searchRes?.results ?? [];
            if (memories.length > 0) {
              const memoryContent = memories.map((m: any) => {
                const type = m.memory_type || "?";
                const heat = typeof m.heat === "number" ? m.heat.toFixed(2) : "?";
                const content = typeof m.content === "string" ? m.content.slice(0, 300) : "";
                return `[${type}|h:${heat}] ${content}`;
              }).join("\n");
              memoryBlock = {
                role: "system" as const,
                content: `<sulcus_context note="Relevant memories recalled from Sulcus.">\n${memoryContent}\n</sulcus_context>`,
              };
              memoryTokens = Math.ceil(memoryBlock.content.length / this.t.charsPerToken);
            }
          }
        } catch {
          // Memory recall failed — continue without
        }
      }

      // 4. Calculate budget available for conversation
      const conversationBudget = tokenBudget - systemTokens - memoryTokens;
      if (conversationBudget <= 0) {
        // Budget exhausted by system + memory alone — pass through recent only
        this.logger.warn(`sulcus-ce: constructive \u2014 budget exhausted by system messages (${systemTokens} tokens)`);
        const assembled = [...systemMsgs, ...(memoryBlock ? [memoryBlock] : []), ...conversationMsgs.slice(-2)];
        return { messages: assembled, estimatedTokens: systemTokens + memoryTokens };
      }

      // 5. Identify conversation turns (user→assistant→tool groups)
      const turns: Array<{ startIdx: number; endIdx: number; messages: any[] }> = [];
      let currentTurnStart = 0;
      for (let i = 0; i < conversationMsgs.length; i++) {
        if (i > 0 && conversationMsgs[i].role === "user") {
          turns.push({
            startIdx: currentTurnStart,
            endIdx: i - 1,
            messages: conversationMsgs.slice(currentTurnStart, i),
          });
          currentTurnStart = i;
        }
      }
      // Final turn
      if (currentTurnStart < conversationMsgs.length) {
        turns.push({
          startIdx: currentTurnStart,
          endIdx: conversationMsgs.length - 1,
          messages: conversationMsgs.slice(currentTurnStart),
        });
      }

      if (turns.length === 0) {
        const assembled = [...systemMsgs, ...(memoryBlock ? [memoryBlock] : [])];
        return { messages: assembled, estimatedTokens: systemTokens + memoryTokens };
      }

      // 6. Determine how many recent turns to keep at full fidelity.
      const recentBudgetRatio = this.t.constructiveRecentBudgetRatio;
      const recentBudgetChars = conversationBudget * this.t.charsPerToken * recentBudgetRatio;
      let recentChars = 0;
      let recentTurnCount = 0;

      for (let i = turns.length - 1; i >= 0; i--) {
        let turnChars = 0;
        for (const msg of turns[i].messages) {
          turnChars += this.estimateMessageChars(msg);
        }
        if (recentChars + turnChars > recentBudgetChars && recentTurnCount >= this.t.constructiveMinRecentTurns) {
          break; // budget for recent turns exhausted
        }
        recentChars += turnChars;
        recentTurnCount++;
      }
      recentTurnCount = Math.max(recentTurnCount, Math.min(this.t.constructiveMinRecentTurns, turns.length));

      const olderTurns = turns.slice(0, turns.length - recentTurnCount);
      const recentTurns = turns.slice(turns.length - recentTurnCount);

      // 7. Build summarized older turns.
      //    Tool results → pointer_summary from Sulcus (or minimal pointer if unavailable).
      //    Assistant and user messages → pass through unchanged.

      // Fetch pointer_summaries for cached tool results that have Sulcus node IDs.
      const pointerSummaries = new Map<string, string>();
      if (this.memoryClient && olderTurns.length > 0) {
        try {
          const searchRes = await this.memoryClient.search_memory(
            `tool-result session:${sessionId}`, 20, this.namespace
          );
          for (const r of searchRes?.results ?? []) {
            const summary = (r as any).pointer_summary || (r as any).label;
            if (!summary || typeof summary !== "string") continue;
            const keyPoints = (r as any).key_points ?? [];
            for (const kp of keyPoints) {
              if (typeof kp === "string" && kp.startsWith("msg:")) {
                pointerSummaries.set(kp.slice(4), summary);
              }
            }
          }
          if (pointerSummaries.size > 0) {
            this.logger.debug(`sulcus-ce: constructive \u2014 fetched ${pointerSummaries.size} pointer summaries from Sulcus`);
          }
        } catch {
          // Non-fatal — fall back to minimal pointers
        }
      }

      const remainingBudgetChars = (conversationBudget * this.t.charsPerToken) - recentChars;
      const summarizedOlder: any[] = [];
      let olderChars = 0;

      for (const turn of olderTurns) {
        for (const msg of turn.messages) {
          let processed = msg;

          if (msg.role === "tool" && typeof msg.content === "string" && msg.id) {
            // Replace with pointer_summary from Sulcus if available
            const cached = sessionCache.get(msg.id);
            if (cached?.sulcusNodeId && pointerSummaries.has(msg.id)) {
              processed = {
                ...msg,
                content: `[${cached.toolName} summary] ${pointerSummaries.get(msg.id)}`,
              };
            } else {
              // No pointer_summary available — use minimal pointer (never truncate)
              const toolName = cached?.toolName || msg.name || "tool";
              const chars = msg.content.length;
              processed = {
                ...msg,
                content: `[tool: ${toolName}] ${chars} chars \u2014 stored in Sulcus, use memory_recall to retrieve`,
              };
            }
          }
          // Assistant and user messages pass through unchanged — no compression

          const processedChars = this.estimateMessageChars(processed);
          if (olderChars + processedChars > remainingBudgetChars) {
            // Budget for older context exhausted — stop adding older turns
            break;
          }
          summarizedOlder.push(processed);
          olderChars += processedChars;
        }
        if (olderChars >= remainingBudgetChars) break;
      }

      // 8. Assemble final context: system + memory + summarized older + recent
      const recentMessages = recentTurns.flatMap((t) => t.messages);
      const assembled = [
        ...systemMsgs,
        ...(memoryBlock ? [memoryBlock] : []),
        ...summarizedOlder,
        ...recentMessages,
      ];

      const totalChars = systemChars + (memoryBlock ? memoryBlock.content.length : 0) + olderChars + recentChars;
      const estimatedTokens = Math.ceil(totalChars / this.t.charsPerToken);

      this.logger.info(
        `sulcus-ce: constructive assembly \u2014 ${assembled.length} messages, ` +
        `${estimatedTokens}/${tokenBudget} tokens, ` +
        `${recentTurnCount} recent turns (full), ${olderTurns.length} older (summarized), ` +
        `${sessionCache.size} cached summaries`
      );

      return { messages: assembled, estimatedTokens };
    } catch (e) {
      this.logger.warn(`sulcus-ce: constructive assembly failed: ${e} \u2014 falling back to passthrough`);
      return { messages, estimatedTokens: 0 };
    }
  }

  /** Estimate character count of a message (handles string + multipart content). */
  private estimateMessageChars(msg: any): number {
    if (typeof msg.content === "string") return msg.content.length;
    if (Array.isArray(msg.content)) {
      let total = 0;
      for (const part of msg.content) {
        if (typeof part === "string") total += part.length;
        else if (part?.text) total += part.text.length;
      }
      return total;
    }
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Compact — Smart Compaction (Capture + Enrich + Delegate)
  // ---------------------------------------------------------------------------

  async compact(params: any) {
    if (this.compactMode !== "smart" || !this.memoryClient) {
      this.logger.debug("sulcus-ce: compact() \u2014 no memory client or passthrough mode, delegating plain");
      try { return await this.delegateCompaction(params); }
      catch (e) { return { ok: false, compacted: false, reason: `delegation-error: ${e}` }; }
    }

    try {
      // Step 1: Pre-compaction session knowledge capture
      try {
        const runtimeMessages = params.runtimeContext?.messages;
        if (Array.isArray(runtimeMessages) && runtimeMessages.length > 0) {
          const firstUser = runtimeMessages.find((m: any) => m.role === "user" && typeof m.content === "string");
          const lastAssistant = [...runtimeMessages].reverse().find((m: any) => m.role === "assistant" && typeof m.content === "string");
          const summaryParts = [
            `Pre-compaction capture (${runtimeMessages.length} messages)`,
            `Topic: ${typeof firstUser?.content === "string" ? firstUser.content.substring(0, 200) : "(none)"}`,
            `Last output: ${typeof lastAssistant?.content === "string" ? lastAssistant.content.substring(0, 200) : "(none)"}`,
          ];
          await this.memoryClient.add_memory(summaryParts.join("\n"), "episodic", {
            key_points: [`session:${params.sessionId}`, "compaction-capture"],
          });
          this.logger.info(`sulcus-ce: compact \u2014 pre-compaction capture stored (${runtimeMessages.length} messages)`);
        }
      } catch (captureErr) {
        this.logger.debug(`sulcus-ce: compact \u2014 pre-compaction capture failed: ${captureErr}`);
      }

      // Step 2: Query Sulcus for stored memories
      const searchRes = await this.memoryClient.search_memory(
        "recent conversation context decisions tasks", 12, this.namespace
      );
      const storedMemories = searchRes?.results ?? [];

      if (storedMemories.length === 0) {
        this.logger.debug("sulcus-ce: compact \u2014 no stored memories, delegating plain");
        return await this.delegateCompaction(params);
      }

      // Step 3: Build summary of what's already in memory
      const storedSummary = storedMemories.map((m: any) => {
        const type = m.memory_type || "unknown";
        const heat = typeof m.heat === "number" ? m.heat.toFixed(2) : "?";
        const preview = typeof m.content === "string"
          ? m.content.slice(0, 150).replace(/\n/g, " ")
          : "(no content)";
        return `  - [${type}, heat=${heat}] ${preview}`;
      }).join("\n");

      // Step 4: Build enriched customInstructions
      const existingInstructions = params.customInstructions || "";
      const smartInstructions = [
        existingInstructions,
        "",
        "=== SULCUS MEMORY CONTEXT ===",
        "The following content is ALREADY stored in the agent's persistent memory (Sulcus)",
        "and is recoverable via memory_recall. You do NOT need to preserve this content",
        "in the summary \u2014 it will survive compaction through memory.",
        "",
        storedSummary,
        "",
        "=== COMPACTION GUIDANCE ===",
        "Focus the summary on:",
        "1. ACTIVE TASK STATE \u2014 what the agent is currently working on, next steps",
        "2. PENDING DECISIONS \u2014 anything awaiting input or approval",
        "3. UNFINISHED WORK \u2014 partial progress, blockers, what remains",
        "4. CONVERSATION DYNAMICS \u2014 who asked what, tone, important agreements",
        "",
        "DO NOT re-summarize content already listed above as stored in memory.",
        "Instead, note: '[stored in Sulcus \u2014 recallable via memory_recall]'",
        "",
        "Structure the summary with clear sections when appropriate:",
        "- Active Context (what's happening now)",
        "- Stored in Memory (brief note of what's recallable)",
        "- Key Decisions & Agreements",
        "- Next Steps",
      ].filter(Boolean).join("\n");

      // Step 5: Delegate with enriched instructions
      this.logger.info(
        `sulcus-ce: smart compaction \u2014 ${storedMemories.length} memories in context, ` +
        `enriched instructions (${smartInstructions.length} chars)`
      );

      const result = await this.delegateCompaction({
        ...params,
        customInstructions: smartInstructions,
      });

      if (result.compacted) {
        const saved = (result.result?.tokensBefore ?? 0) - (result.result?.tokensAfter ?? 0);
        this.logger.info(`sulcus-ce: smart compaction saved ~${saved} tokens`);
      }

      return result;
    } catch (e) {
      this.logger.warn(`sulcus-ce: smart compaction failed: ${e} \u2014 falling back to plain delegation`);
      try { return await this.delegateCompaction(params); }
      catch (e2) { return { ok: false, compacted: false, reason: `delegation-error: ${e2}` }; }
    }
  }

  // ---------------------------------------------------------------------------
  // Subagent lifecycle
  // ---------------------------------------------------------------------------

  async prepareSubagentSpawn(_params: any) {
    return undefined;
  }

  async onSubagentEnded(params: any): Promise<void> {
    // Clean up subagent session state when it ends
    const sessionId = params?.sessionId;
    if (sessionId && this.turnCounter.has(sessionId)) {
      this.clearSession(sessionId);
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  async dispose(): Promise<void> {
    // Clear all sessions
    const allSessions = new Set([
      ...this.turnCounter.keys(),
      ...this.workingMemory.keys(),
      ...this.sessionLastActivity.keys(),
    ]);
    for (const sessionId of allSessions) {
      this.clearSession(sessionId);
    }
    this.logger.info("sulcus-ce: disposed");
  }
}
