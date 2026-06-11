/**
 * Sulcus Context Engine — Phase 6 (Deterministic Assembly)
 *
 * Registers openclaw-sulcus as an OpenClaw Context Engine with ownsCompaction: true.
 *
 * Phase 1: Safe delegate — all methods passthrough to built-in runtime.
 * Phase 1.5: Proactive overflow prevention via afterTurn():
 *   - Monitors token pressure between tool calls
 *   - At 65%: trims large tool results (>3k chars → head/tail with marker)
 *   - At 75%: triggers preemptive compaction via delegate
 * Phase 2: Memory-aware assembly via assemble():
 *   - Queries Sulcus for memories relevant to current conversation
 *   - Injects a compact memory index showing what's stored and recallable
 *   - When over 85% budget: compresses messages whose content is already in Sulcus
 * Phase 3: Smart compaction via compact():
 *   - Enriches compaction LLM with memory context before delegating
 *   - Guides compactor to skip content already durable in memory
 * Phase 4: Mid-loop memory capture via afterTurn():
 *   - Captures large tool results to Sulcus BEFORE trimming (lossless)
 *   - Trim stage uses capture-aware markers
 * Phase 5: Unified memory lifecycle:
 *   - Continuous session knowledge capture (decisions, files, episodes) in afterTurn()
 *   - Pre-compaction capture integrated into compact()
 *   - Full recalled memory injection in assemble() when under budget
 *   - pre_compaction_capture hook skipped when engine is active
 * Phase 5.5: Overflow hardening (prevents 223k-token blowouts):
 *   - LARGE_RESULT_CHARS lowered 6000 → 3000 (SSH outputs are 2-4k each)
 *   - Cumulative pressure tracking: total tool chars >50k + >50% usage → trim biggest
 *   - Adaptive compaction interval: growth >10k tok/turn → compact every turn
 *   - Emergency brake at 90%: aggressively trim ALL tool results (500 head/tail)
 *   - Growth rate EMA tracking for predictive compaction
 * Phase 6: Deterministic assembly (constructive mode):
 *   - Working memory cache — per-session Map of tool result entries
 *   - ingest()/ingestBatch() — populate cache, store full content to Sulcus
 *   - SILU generates pointer_summary server-side for stored tool results
 *   - assembleConstructive() — builds context from cache + recent turns
 *   - Budget-driven: recent N turns at full fidelity, older turns use pointer_summary
 *   - No transcript patching — context is a constructed view, not a patched log
 *   - All thresholds configurable via ContextEngineThresholds
 */

// ---------------------------------------------------------------------------
// Configurable Thresholds
// ---------------------------------------------------------------------------

/** All tunable thresholds for the Sulcus context engine. */
export interface ContextEngineThresholds {
  /** Trigger preemptive compaction when context reaches this fraction of budget. */
  compactionTriggerRatio: number;
  /** Start trimming large tool results at this fraction of budget. */
  trimTriggerRatio: number;
  /**
   * When trimming, target tool results larger than this char count.
   * SSH outputs are typically 2-4k chars each; 50 at 3k = ~37k tokens.
   */
  largeResultChars: number;
  /** Trimmed tool results keep this many chars from head. */
  trimHeadChars: number;
  /** Trimmed tool results keep this many chars from tail. */
  trimTailChars: number;
  /** Emergency brake head chars — used at 90%+ budget pressure. */
  emergencyHeadChars: number;
  /** Emergency brake tail chars — used at 90%+ budget pressure. */
  emergencyTailChars: number;
  /** Emergency brake trigger — aggressively trim ALL tool results above this ratio. */
  emergencyBrakeRatio: number;
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
  /** Minimum chars for a tool result to be worth capturing to memory. */
  captureMinChars: number;
  /** Max captures per afterTurn call to avoid hammering Sulcus. */
  maxCapturesPerTurn: number;
  /** Budget ratio at which we start capturing (before trim). */
  captureTriggerRatio: number;
  /**
   * Cumulative tool result chars threshold. When total tool output exceeds
   * this AND usage is above cumulativePressureRatio, trim oldest/largest.
   */
  cumulativeToolCharsThreshold: number;
  /** Budget ratio at which cumulative pressure trimming kicks in. */
  cumulativePressureRatio: number;
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
  /** Max chars per sentence kept in compressAssistantMessage. */
  compressSentenceMaxChars: number;
  /** Max total chars for compressed assistant message output. */
  compressMaxChars: number;
  /** TTL for stale sessions in milliseconds (default: 2 hours). */
  sessionTtlMs: number;
}

/** Default threshold values — match original hardcoded behavior. */
export const DEFAULT_THRESHOLDS: ContextEngineThresholds = {
  compactionTriggerRatio: 0.75,
  trimTriggerRatio: 0.65,
  largeResultChars: 3000,
  trimHeadChars: 1500,
  trimTailChars: 1500,
  emergencyHeadChars: 500,
  emergencyTailChars: 500,
  emergencyBrakeRatio: 0.90,
  minTurnsBetweenCompaction: 3,
  highGrowthRateThreshold: 10_000,
  charsPerToken: 4,
  captureMinChars: 4000,
  maxCapturesPerTurn: 3,
  captureTriggerRatio: 0.55,
  cumulativeToolCharsThreshold: 50_000,
  cumulativePressureRatio: 0.50,
  knowledgeCaptureInterval: 8,
  knowledgeCaptureRatio: 0.40,
  constructiveMinRecentTurns: 4,
  assemblyInjectRatio: 0.85,
  assemblyRecallRatio: 0.70,
  assemblyRecallCapRatio: 0.80,
  constructiveRecentBudgetRatio: 0.60,
  compressSentenceMaxChars: 200,
  compressMaxChars: 600,
  sessionTtlMs: 2 * 60 * 60 * 1000, // 2 hours
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
  assemblyMode: "passthrough" | "memory-aware" | "constructive";  // Phase 6
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
  // Phase 4: Track message IDs already captured to Sulcus
  private capturedMsgIds = new Map<string, Set<string>>();
  // Phase 5: Track session knowledge capture turns
  private lastKnowledgeCaptureTurn = new Map<string, number>();
  // Phase 5.5: Growth rate tracking (tokens at previous turn, for delta)
  private lastTokenCount = new Map<string, number>();
  private growthRate = new Map<string, number>(); // tokens/turn EMA
  // Phase 5.5: Cumulative tool result chars per session
  private cumulativeToolChars = new Map<string, number>();
  // Bug fix: Track which message IDs have been counted for cumulative tool chars
  private countedToolMsgIds = new Map<string, Set<string>>();
  // Phase 6: Working memory cache per session — summaries of tool results
  private workingMemory = new Map<string, Map<string, WorkingMemoryEntry>>();
  // Bug fix: Track last-scanned message index for knowledge capture per session
  private lastKnowledgeScanIndex = new Map<string, number>();
  // Bug fix: Track last activity timestamp per session for TTL eviction
  private sessionLastActivity = new Map<string, number>();

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
      `sulcus-context-engine: initialized v${config.version} (assembly=${this.assemblyMode}, compact=${this.compactMode}, capture=unified, overflow=hardened)`
    );
    this.logger.info(
      `sulcus-context-engine: thresholds: ${JSON.stringify(this.t)}`
    );
  }

  // ---------------------------------------------------------------------------
  // Bootstrap / Maintain / Ingest — still no-op
  // ---------------------------------------------------------------------------

  async bootstrap(_params: any) {
    return { bootstrapped: false, reason: "phase-5" };
  }

  async maintain(_params: any) {
    return { changed: false, bytesFreed: 0, rewrittenEntries: 0, reason: "phase-5" };
  }

  /**
   * Ingest a single message into working memory.
   * For tool results: cache metadata, store full content to Sulcus (SILU generates pointer_summary).
   * Uses unified capturedMsgIds dedup guard to prevent triple-ingestion.
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

    // Store full content to Sulcus — SILU will generate pointer_summary automatically
    // Only store if not already captured by another path (captureToolResults / afterTurn)
    if (this.memoryClient && message.content.length >= this.t.captureMinChars && !sessionCaptured.has(message.id)) {
      try {
        const res = await this.memoryClient.add_memory(
          `[Tool: ${toolName}]\n${message.content}`,
          "episodic",
          { key_points: [`tool-result:${toolName}`, `session:${sessionId}`, `msg:${message.id}`] },
        );
        entry.sulcusNodeId = res?.id;
        sessionCaptured.add(message.id);
        this.logger.debug(`sulcus-ce: ingested tool result to memory (${toolName}, ${message.content.length} chars) [msg=${message.id}]`);
      } catch {
        this.logger.debug(`sulcus-ce: memory store failed for ingest [msg=${message.id}]`);
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

  /** Get or create the counted tool message ID set for a session. */
  private getSessionCountedIds(sessionId: string): Set<string> {
    let ids = this.countedToolMsgIds.get(sessionId);
    if (!ids) {
      ids = new Set();
      this.countedToolMsgIds.set(sessionId, ids);
    }
    return ids;
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
    this.countedToolMsgIds.delete(sessionId);
    this.lastKnowledgeCaptureTurn.delete(sessionId);
    this.lastKnowledgeScanIndex.delete(sessionId);
    this.lastTokenCount.delete(sessionId);
    this.growthRate.delete(sessionId);
    this.cumulativeToolChars.delete(sessionId);
    this.workingMemory.delete(sessionId);
    this.sessionLastActivity.delete(sessionId);
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
  // afterTurn — THE OVERFLOW PREVENTION + KNOWLEDGE CAPTURE
  // ---------------------------------------------------------------------------

  async afterTurn(params: any): Promise<void> {
    const {
      sessionId,
      sessionFile,
      messages,
      tokenBudget,
      runtimeContext,
    } = params;

    const turn = (this.turnCounter.get(sessionId) ?? 0) + 1;
    this.turnCounter.set(sessionId, turn);

    // Track session activity for TTL eviction
    this.sessionLastActivity.set(sessionId, Date.now());

    // Periodically evict stale sessions (every 10 turns to avoid overhead)
    if (turn % 10 === 0) {
      this.evictStaleSessions();
    }

    const budget = tokenBudget ?? runtimeContext?.tokenBudget;
    const currentTokens = runtimeContext?.currentTokenCount;

    if (!budget || !currentTokens) return;

    const usage = currentTokens / budget;
    const usagePct = (usage * 100).toFixed(1);

    // ----- Growth rate tracking (EMA) -----
    // Measure how fast the context is growing per turn.
    // This drives adaptive compaction intervals.
    const prevTokens = this.lastTokenCount.get(sessionId);
    const hasPrevious = prevTokens !== undefined;
    this.lastTokenCount.set(sessionId, currentTokens);

    // Bug fix: On first turn, prevTokens is undefined (no prior measurement).
    // tokensAddedThisTurn would be currentTokens (20-50k from system prompt),
    // which inflates the EMA and triggers aggressive compaction too early.
    // Fix: skip EMA update on first turn, seed growth rate at 0.
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

    // ----- Cumulative tool chars tracking -----
    // Track total tool result characters in this session.
    // Bug fix: Only count chars from messages not already counted (by ID).
    // Previously re-counted ALL tool messages every turn, inflating totals.
    let sessionToolChars = this.cumulativeToolChars.get(sessionId) ?? 0;
    const countedIds = this.getSessionCountedIds(sessionId);
    for (const msg of messages) {
      if (msg.role === "tool" && typeof msg.content === "string" && msg.id) {
        if (countedIds.has(msg.id)) continue; // already counted in a previous turn
        // Only count if not already trimmed
        if (!msg.content.includes("[\u2026 trimmed by sulcus-ce") && !msg.content.includes("[captured by sulcus-ce")) {
          sessionToolChars += msg.content.length;
          countedIds.add(msg.id);
        }
      }
    }
    this.cumulativeToolChars.set(sessionId, sessionToolChars);

    if (usage > 0.5) {
      this.logger.debug(
        `sulcus-ce: context pressure ${usagePct}% (${currentTokens}/${budget} tokens, growth: ${newGrowth} tok/turn, cumToolChars: ${sessionToolChars}) [session=${sessionId}, turn=${turn}]`
      );
    }

    // Stage 0.5 (Phase 4): Capture large tool results to Sulcus BEFORE trimming
    if (usage >= this.t.captureTriggerRatio && this.memoryClient) {
      await this.captureToolResults(messages, sessionId, turn);
    }

    // Stage 0.75 (Phase 5): Continuous session knowledge capture
    if (
      usage >= this.t.knowledgeCaptureRatio &&
      this.memoryClient &&
      turn - (this.lastKnowledgeCaptureTurn.get(sessionId) ?? 0) >= this.t.knowledgeCaptureInterval
    ) {
      await this.captureSessionKnowledge(messages, sessionId, turn, usagePct);
    }

    // Phase 6: Populate working memory cache with tool results.
    // In constructive mode, assembly handles budget enforcement — no trimming needed.
    // Full content is stored to Sulcus; SILU generates pointer_summary server-side.
    // Bug fix: Uses unified capturedMsgIds dedup guard to prevent triple-ingestion.
    // Bug fix: Still runs compaction check after caching (don't skip entirely).
    if (this.assemblyMode === "constructive") {
      const sessionCache = this.getSessionCache(sessionId);
      const sessionCapturedCtv = this.getSessionCapturedIds(sessionId);
      let newCached = 0;
      for (const msg of messages) {
        if (msg.role !== "tool" || typeof msg.content !== "string" || !msg.id) continue;
        if (sessionCache.has(msg.id)) continue; // already cached
        if (msg.content.length < 200) continue; // too small

        const toolName = msg.name || "tool";

        const entry: WorkingMemoryEntry = {
          messageId: msg.id,
          toolName,
          originalLength: msg.content.length,
          turn,
        };

        // Store full content to Sulcus — SILU generates pointer_summary automatically
        // Unified dedup: only store if not already captured by captureToolResults or ingest
        if (this.memoryClient && msg.content.length >= this.t.captureMinChars && !sessionCapturedCtv.has(msg.id)) {
          this.memoryClient.add_memory(
            `[Tool: ${toolName}]\n${msg.content}`,
            "episodic",
            { key_points: [`tool-result:${toolName}`, `session:${sessionId}`, `msg:${msg.id}`] },
          ).then((res) => {
            entry.sulcusNodeId = res?.id;
            sessionCapturedCtv.add(msg.id);
          }).catch(() => {
            // Non-fatal — entry is still in working memory
          });
        }

        sessionCache.set(msg.id, entry);
        newCached++;
      }
      if (newCached > 0) {
        this.logger.debug(`sulcus-ce: cached ${newCached} tool results (total: ${sessionCache.size}) [turn=${turn}]`);
      }
      // Bug fix: In constructive mode, skip trimming but still run compaction check.
      // The runtime's overflow guard fires uncontrolled if we never compact.
      // We delegate compaction (which summarizes the session file) but skip transcript trimming.
      if (usage >= this.t.compactionTriggerRatio) {
        const lastCompaction = this.lastCompactionTurn.get(sessionId) ?? 0;
        const turnsSinceCompaction = turn - lastCompaction;
        const minTurns = newGrowth >= this.t.highGrowthRateThreshold ? 1 : this.t.minTurnsBetweenCompaction;

        if (turnsSinceCompaction >= minTurns) {
          this.logger.info(
            `sulcus-ce: CONSTRUCTIVE COMPACTION at ${usagePct}% (${currentTokens}/${budget}). ` +
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
              this.logger.info(`sulcus-ce: constructive compaction succeeded — saved ~${saved} tokens`);
            }
          } catch (e) {
            this.logger.warn(`sulcus-ce: constructive compaction failed: ${e}`);
          }
        }
      }
      return;
    }

    // **EMERGENCY BRAKE at 90%** — aggressively trim ALL tool results to 500 head/tail.
    // This is the last-resort guard before context overflow. No exceptions.
    if (usage >= this.t.emergencyBrakeRatio && runtimeContext?.rewriteTranscriptEntries) {
      this.logger.warn(
        `sulcus-ce: ⚠️ EMERGENCY BRAKE at ${usagePct}% (${currentTokens}/${budget}) — ` +
        `aggressively trimming ALL tool results [session=${sessionId}, turn=${turn}]`
      );
      await this.emergencyTrimAllToolResults(messages, runtimeContext.rewriteTranscriptEntries, sessionId);
    }

    // **Cumulative pressure trimming** — when total tool output is excessive
    // AND usage is building, trim the largest tool results even if they're
    // individually under the LARGE_RESULT_CHARS threshold.
    if (
      usage >= this.t.cumulativePressureRatio &&
      sessionToolChars >= this.t.cumulativeToolCharsThreshold &&
      runtimeContext?.rewriteTranscriptEntries &&
      usage < this.t.emergencyBrakeRatio // don't double-trim after emergency
    ) {
      this.logger.info(
        `sulcus-ce: cumulative pressure trim — ${sessionToolChars} total tool chars, ` +
        `${usagePct}% budget [session=${sessionId}]`
      );
      await this.trimCumulativePressure(messages, runtimeContext.rewriteTranscriptEntries, sessionId);
    }

    // Stage 1: Trim large tool results at 65% (now lossless when captured above)
    if (
      usage >= this.t.trimTriggerRatio &&
      usage < this.t.emergencyBrakeRatio && // emergency already handled
      runtimeContext?.rewriteTranscriptEntries
    ) {
      await this.trimLargeToolResults(messages, runtimeContext.rewriteTranscriptEntries, sessionId);
    }

    // Stage 2: Preemptive compaction at 75%
    if (usage >= this.t.compactionTriggerRatio) {
      const lastCompaction = this.lastCompactionTurn.get(sessionId) ?? 0;
      const turnsSinceCompaction = turn - lastCompaction;

      // Adaptive compaction interval: when growth rate is high (>10k tok/turn),
      // compact every turn. This prevents runaway sessions (50+ SSH commands,
      // code audits) from blowing past the budget before compaction fires.
      const minTurns = newGrowth >= this.t.highGrowthRateThreshold ? 1 : this.t.minTurnsBetweenCompaction;

      if (turnsSinceCompaction >= minTurns) {
        this.logger.info(
          `sulcus-ce: PREEMPTIVE COMPACTION at ${usagePct}% (${currentTokens}/${budget}). ` +
          `Growth: ${newGrowth} tok/turn, interval: ${minTurns}, turns since last: ${turnsSinceCompaction}. [session=${sessionId}]`
        );

        try {
          const result = await this.delegateCompaction({
            sessionId,
            sessionFile,
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
          this.logger.warn(`sulcus-ce: preemptive compaction failed: ${e}`);
        }
      } else {
        this.logger.debug(
          `sulcus-ce: skipping compaction (only ${turnsSinceCompaction} turns since last, need ${minTurns})`
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 4: Capture tool results to Sulcus before trimming
  // ---------------------------------------------------------------------------

  private async captureToolResults(
    messages: any[],
    sessionId: string,
    turn: number,
  ): Promise<void> {
    // Use unified dedup guard
    const sessionCaptured = this.getSessionCapturedIds(sessionId);

    let captureCount = 0;
    for (const msg of messages) {
      if (captureCount >= this.t.maxCapturesPerTurn) break;
      if (msg.role !== "tool" || typeof msg.content !== "string") continue;
      if (!msg.id || msg.content.length < this.t.captureMinChars) continue;
      if (sessionCaptured.has(msg.id)) continue;
      if (msg.content.includes("[… trimmed by sulcus-ce")) continue;
      if (msg.content.includes("[captured by sulcus-ce")) continue;

      try {
        const toolName = msg.name || "tool-result";
        const firstLine = msg.content.slice(0, 200).split("\n")[0];
        const captureContent = [
          `[Tool result: ${toolName}] ${firstLine}`,
          "",
          msg.content,
        ].join("\n");

        await this.memoryClient!.add_memory(captureContent, "episodic", {
          key_points: [`tool-result:${toolName}`, `session:${sessionId}`, `msg:${msg.id}`],
        });
        sessionCaptured.add(msg.id);
        captureCount++;
        this.logger.debug(
          `sulcus-ce: captured tool result to memory (${toolName}, ${msg.content.length} chars) [msg=${msg.id}]`
        );
      } catch (e) {
        this.logger.warn(`sulcus-ce: memory capture failed for msg ${msg.id}: ${e}`);
      }
    }

    if (captureCount > 0) {
      this.logger.info(`sulcus-ce: captured ${captureCount} tool results to Sulcus memory [session=${sessionId}, turn=${turn}]`);
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 5: Continuous session knowledge capture
  // ---------------------------------------------------------------------------

  private async captureSessionKnowledge(
    messages: any[],
    sessionId: string,
    turn: number,
    usagePct: string,
  ): Promise<void> {
    this.lastKnowledgeCaptureTurn.set(sessionId, turn);

    try {
      // Bug fix: Only scan messages from lastKnowledgeScanIndex forward.
      // Previously re-scanned ALL messages every interval, re-extracting
      // the same decisions and files.
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
  // Trim large tool results (capture-aware)
  // ---------------------------------------------------------------------------

  private async trimLargeToolResults(
    messages: any[],
    rewriteTranscript: (req: any) => Promise<any>,
    sessionId: string,
  ): Promise<void> {
    const sessionCaptured = this.getSessionCapturedIds(sessionId);
    const replacements: any[] = [];

    for (const msg of messages) {
      if (msg.role !== "tool" || typeof msg.content !== "string") continue;
      if (msg.content.length <= this.t.largeResultChars) continue;
      if (!msg.id) continue;
      if (msg.content.includes("[… trimmed by sulcus-ce")) continue;
      if (msg.content.includes("[captured by sulcus-ce")) continue;

      const wasCaptured = sessionCaptured.has(msg.id);
      const toolName = msg.name || "tool-result";
      const head = msg.content.slice(0, this.t.trimHeadChars);
      const tail = msg.content.slice(-this.t.trimTailChars);
      const trimmed = msg.content.length - this.t.trimHeadChars - this.t.trimTailChars;

      const marker = wasCaptured
        ? `[captured by sulcus-ce — full content stored in memory, use memory_recall for "${toolName}" to retrieve]`
        : `[… trimmed by sulcus-ce: ${trimmed} chars removed …]`;

      replacements.push({
        entryId: msg.id,
        message: { ...msg, content: `${head}\n\n${marker}\n\n${tail}` },
      });
    }

    if (replacements.length > 0) {
      try {
        const result = await rewriteTranscript({ replacements });
        if (result.changed) {
          this.logger.info(
            `sulcus-ce: trimmed ${result.rewrittenEntries} large tool results, freed ~${result.bytesFreed} bytes [session=${sessionId}]`
          );
        }
      } catch (e) {
        this.logger.warn(`sulcus-ce: transcript rewrite failed: ${e}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Emergency brake: aggressively trim ALL tool results at 90%+ budget.
  // Last-resort guard before context overflow. 500 char head + 500 char tail.
  // ---------------------------------------------------------------------------

  private async emergencyTrimAllToolResults(
    messages: any[],
    rewriteTranscript: (req: any) => Promise<any>,
    sessionId: string,
  ): Promise<void> {
    const replacements: any[] = [];

    for (const msg of messages) {
      if (msg.role !== "tool" || typeof msg.content !== "string") continue;
      if (!msg.id) continue;
      // Trim anything over 1200 chars (EMERGENCY_HEAD + EMERGENCY_TAIL + some padding)
      if (msg.content.length <= this.t.emergencyHeadChars + this.t.emergencyTailChars + 200) continue;
      // Don't re-trim already-trimmed messages
      if (msg.content.includes("[\u26a0\ufe0f EMERGENCY trimmed by sulcus-ce")) continue;

      const head = msg.content.slice(0, this.t.emergencyHeadChars);
      const tail = msg.content.slice(-this.t.emergencyTailChars);
      const trimmed = msg.content.length - this.t.emergencyHeadChars - this.t.emergencyTailChars;

      replacements.push({
        entryId: msg.id,
        message: {
          ...msg,
          content: `${head}\n\n[\u26a0\ufe0f EMERGENCY trimmed by sulcus-ce: ${trimmed} chars removed — context at 90%+ budget]\n\n${tail}`,
        },
      });
    }

    if (replacements.length > 0) {
      try {
        const result = await rewriteTranscript({ replacements });
        if (result.changed) {
          this.logger.warn(
            `sulcus-ce: \u26a0\ufe0f EMERGENCY trimmed ${result.rewrittenEntries} tool results, freed ~${result.bytesFreed} bytes [session=${sessionId}]`
          );
        }
      } catch (e) {
        this.logger.warn(`sulcus-ce: emergency transcript rewrite failed: ${e}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cumulative pressure trimming: when total tool output exceeds 50k chars AND
  // budget usage is >50%, trim the oldest/largest tool results even if they’re
  // individually under LARGE_RESULT_CHARS. Targets the biggest offenders first.
  // ---------------------------------------------------------------------------

  private async trimCumulativePressure(
    messages: any[],
    rewriteTranscript: (req: any) => Promise<any>,
    sessionId: string,
  ): Promise<void> {
    // Collect all untrimmed tool results sorted by size (largest first)
    const toolMsgs: Array<{ idx: number; msg: any; size: number }> = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== "tool" || typeof msg.content !== "string" || !msg.id) continue;
      if (msg.content.includes("[\u2026 trimmed by sulcus-ce")) continue;
      if (msg.content.includes("[captured by sulcus-ce")) continue;
      if (msg.content.includes("[\u26a0\ufe0f EMERGENCY trimmed")) continue;
      // Only target results over 1000 chars (trim smaller ones isn't worth it)
      if (msg.content.length < 1000) continue;
      toolMsgs.push({ idx: i, msg, size: msg.content.length });
    }

    if (toolMsgs.length === 0) return;

    // Sort by size descending — trim biggest first for maximum reclaim
    toolMsgs.sort((a, b) => b.size - a.size);

    // Trim up to half of the candidates (be aggressive but not scorched-earth)
    const trimCount = Math.max(1, Math.ceil(toolMsgs.length / 2));
    const sessionCaptured = this.getSessionCapturedIds(sessionId);
    const replacements: any[] = [];

    for (let i = 0; i < trimCount; i++) {
      const { msg } = toolMsgs[i];
      const wasCaptured = sessionCaptured.has(msg.id);
      const toolName = msg.name || "tool-result";
      const head = msg.content.slice(0, this.t.trimHeadChars);
      const tail = msg.content.slice(-this.t.trimTailChars);
      const trimmed = msg.content.length - this.t.trimHeadChars - this.t.trimTailChars;

      if (trimmed <= 0) continue; // too small to trim

      const marker = wasCaptured
        ? `[captured by sulcus-ce — full content stored in memory, use memory_recall for "${toolName}" to retrieve]`
        : `[\u2026 trimmed by sulcus-ce (cumulative pressure): ${trimmed} chars removed \u2026]`;

      replacements.push({
        entryId: msg.id,
        message: { ...msg, content: `${head}\n\n${marker}\n\n${tail}` },
      });
    }

    if (replacements.length > 0) {
      try {
        const result = await rewriteTranscript({ replacements });
        if (result.changed) {
          this.logger.info(
            `sulcus-ce: cumulative pressure trimmed ${result.rewrittenEntries} tool results, ` +
            `freed ~${result.bytesFreed} bytes [session=${sessionId}]`
          );
        }
      } catch (e) {
        this.logger.warn(`sulcus-ce: cumulative pressure rewrite failed: ${e}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Assemble — Phase 5: Memory-Aware Assembly with Full Recall
  // ---------------------------------------------------------------------------

  async assemble(params: any) {
    // Phase 6: Constructive assembly — build context from cache, not trim transcript
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
        return `- [${type}|h:${heat}] ${preview}${m.content?.length > 120 ? "…" : ""}`;
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
        // Phase 5: When well under budget, inject full recalled content
        // for top-scoring memories — gives the model actual context to work with.
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
            content: `[stored in sulcus — use memory_recall to retrieve] ${summary}…`,
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
      this.logger.info(`sulcus-ce: assemble — memory-aware compression saved ~${savedTokens} tokens (${estimatedTokens} → ${compressedTokens})`);
      return { messages: assembled, estimatedTokens: compressedTokens };

    } catch (e) {
      this.logger.warn(`sulcus-ce: assemble memory-aware failed: ${e} — falling back to passthrough`);
      return { messages: params.messages, estimatedTokens: 0 };
    }
  }

  // ---------------------------------------------------------------------------
  // Constructive Assembly — Phase 6
  // Builds context deterministically: system messages + memory injection +
  // recent turns at full fidelity + older turns with summaries. Always fits
  // within tokenBudget. No transcript patching.
  // ---------------------------------------------------------------------------

  /**
   * Build context from working memory cache + recent turns.
   *
   * - System messages: pass through unchanged
   * - Recent N turns: pass through at full fidelity (agent needs recent context verbatim)
   * - Older tool results: replaced with their cached summary
   * - Older assistant messages: keep decisions/actions, compress verbose reasoning
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
        this.logger.warn(`sulcus-ce: constructive — budget exhausted by system messages (${systemTokens} tokens)`);
        const assembled = [...systemMsgs, ...(memoryBlock ? [memoryBlock] : []), ...conversationMsgs.slice(-2)];
        return { messages: assembled, estimatedTokens: systemTokens + memoryTokens };
      }

      // 5. Identify conversation turns (user→assistant→tool groups)
      //    Walk backward to build recent vs older separation.
      //    A "turn" = one user message + all subsequent assistant/tool messages until next user.
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
      //    Walk backward, accumulating chars, until we've used ~60% of conversation budget.
      //    Always keep at least this.t.constructiveMinRecentTurns.
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
      //    Tool results → pointer_summary from Sulcus. Assistant messages → keep decisions, trim reasoning.
      //    User messages → keep (they're usually short).

      // Fetch pointer_summaries for cached tool results that have Sulcus node IDs.
      const pointerSummaries = new Map<string, string>();
      if (this.memoryClient && olderTurns.length > 0) {
        try {
          // Search for tool results stored in this session
          const searchRes = await this.memoryClient.search_memory(
            `tool-result session:${sessionId}`, 20, this.namespace
          );
          for (const r of searchRes?.results ?? []) {
            const summary = (r as any).pointer_summary || (r as any).label;
            if (!summary || typeof summary !== "string") continue;
            // Match by key_points containing msg:<id>
            const keyPoints = (r as any).key_points ?? [];
            for (const kp of keyPoints) {
              if (typeof kp === "string" && kp.startsWith("msg:")) {
                pointerSummaries.set(kp.slice(4), summary);
              }
            }
          }
          if (pointerSummaries.size > 0) {
            this.logger.debug(`sulcus-ce: constructive — fetched ${pointerSummaries.size} pointer summaries from Sulcus`);
          }
        } catch {
          // Non-fatal — fall back to truncation
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
            } else if (cached) {
              // Bug fix: Log when pointer_summary is missing for a cached entry with sulcusNodeId
              if (cached.sulcusNodeId) {
                this.logger.warn(
                  `sulcus-ce: constructive — pointer_summary not found for cached tool result ` +
                  `(${cached.toolName}, node=${cached.sulcusNodeId}, msg=${msg.id}). Falling back to truncation.`
                );
              }
              // Cached but no pointer_summary yet — use head/tail truncation
              const preview = msg.content.length > 500
                ? msg.content.slice(0, 250) + "\n…\n" + msg.content.slice(-250)
                : msg.content;
              processed = {
                ...msg,
                content: `[${cached.toolName}] ${preview}`,
              };
            } else if (msg.content.length > 500) {
              // No cache at all — truncate
              const toolName = msg.name || "tool";
              const preview = msg.content.slice(0, 250) + "\n…\n" + msg.content.slice(-250);
              processed = {
                ...msg,
                content: `[${toolName}] ${preview}`,
              };
            }
          } else if (msg.role === "assistant" && typeof msg.content === "string" && msg.content.length > 1000) {
            // Compress verbose assistant reasoning — keep decisions and actions
            processed = {
              ...msg,
              content: this.compressAssistantMessage(msg.content),
            };
          }
          // User messages pass through unchanged (usually short)

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
        `sulcus-ce: constructive assembly — ${assembled.length} messages, ` +
        `${estimatedTokens}/${tokenBudget} tokens, ` +
        `${recentTurnCount} recent turns (full), ${olderTurns.length} older (summarized), ` +
        `${sessionCache.size} cached summaries`
      );

      return { messages: assembled, estimatedTokens };
    } catch (e) {
      this.logger.warn(`sulcus-ce: constructive assembly failed: ${e} — falling back to passthrough`);
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

  /**
   * Compress a verbose assistant message: keep decision sentences, trim reasoning.
   * Returns the compressed content (200–600 chars).
   */
  private compressAssistantMessage(content: string): string {
    const sentences = content.split(/(?<=[.!?\n])\s+/).filter((s) => s.trim().length > 10);

    // Keep sentences that contain decision markers
    const decisionSentences = sentences.filter((s) => {
      const lc = s.toLowerCase();
      return DECISION_MARKERS.some((m) => lc.includes(m));
    });

    // Also keep first and last sentences for context
    const maxSentence = this.t.compressSentenceMaxChars;
    const maxOutput = this.t.compressMaxChars;
    const kept: string[] = [];
    if (sentences.length > 0) kept.push(sentences[0].slice(0, maxSentence));
    for (const ds of decisionSentences.slice(0, 3)) {
      if (!kept.includes(ds.slice(0, maxSentence))) kept.push(ds.slice(0, maxSentence));
    }
    if (sentences.length > 1) {
      const last = sentences[sentences.length - 1].slice(0, maxSentence);
      if (!kept.includes(last)) kept.push(last);
    }

    if (kept.length === 0) {
      return content.slice(0, maxSentence * 2) + "\u2026";
    }

    const compressed = kept.join(" ");
    if (compressed.length > maxOutput) return compressed.slice(0, maxOutput - 3) + "\u2026";
    return compressed;
  }

  // ---------------------------------------------------------------------------
  // Compact — Phase 5: Unified Compaction (Capture + Enrich + Delegate)
  // ---------------------------------------------------------------------------

  async compact(params: any) {
    if (this.compactMode !== "smart" || !this.memoryClient) {
      this.logger.debug("sulcus-ce: compact() — no memory client or passthrough mode, delegating plain");
      try { return await this.delegateCompaction(params); }
      catch (e) { return { ok: false, compacted: false, reason: `delegation-error: ${e}` }; }
    }

    try {
      // Phase 5 Step 1: Pre-compaction session knowledge capture
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
          this.logger.info(`sulcus-ce: compact — pre-compaction capture stored (${runtimeMessages.length} messages)`);
        }
      } catch (captureErr) {
        this.logger.debug(`sulcus-ce: compact — pre-compaction capture failed: ${captureErr}`);
      }

      // Phase 3 Step 2: Query Sulcus for stored memories
      const searchRes = await this.memoryClient.search_memory(
        "recent conversation context decisions tasks", 12, this.namespace
      );
      const storedMemories = searchRes?.results ?? [];

      if (storedMemories.length === 0) {
        this.logger.debug("sulcus-ce: compact — no stored memories, delegating plain");
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
        "in the summary — it will survive compaction through memory.",
        "",
        storedSummary,
        "",
        "=== COMPACTION GUIDANCE ===",
        "Focus the summary on:",
        "1. ACTIVE TASK STATE — what the agent is currently working on, next steps",
        "2. PENDING DECISIONS — anything awaiting input or approval",
        "3. UNFINISHED WORK — partial progress, blockers, what remains",
        "4. CONVERSATION DYNAMICS — who asked what, tone, important agreements",
        "",
        "DO NOT re-summarize content already listed above as stored in memory.",
        "Instead, note: '[stored in Sulcus — recallable via memory_recall]'",
        "",
        "Structure the summary with clear sections when appropriate:",
        "- Active Context (what's happening now)",
        "- Stored in Memory (brief note of what's recallable)",
        "- Key Decisions & Agreements",
        "- Next Steps",
      ].filter(Boolean).join("\n");

      // Step 5: Delegate with enriched instructions
      this.logger.info(
        `sulcus-ce: smart compaction — ${storedMemories.length} memories in context, ` +
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
      this.logger.warn(`sulcus-ce: smart compaction failed: ${e} — falling back to plain delegation`);
      try { return await this.delegateCompaction(params); }
      catch (e2) { return { ok: false, compacted: false, reason: `delegation-error: ${e2}` }; }
    }
  }

  // ---------------------------------------------------------------------------
  // Subagent lifecycle — no-op
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