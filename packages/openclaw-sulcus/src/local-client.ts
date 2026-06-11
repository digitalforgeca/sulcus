// @ts-nocheck
/**
 * SulcusLocalClient — HTTP client for a local Sulcus sidecar.
 *
 * Mirrors the critical subset of SulcusCloudClient's API surface but talks to
 * a localhost endpoint (e.g. http://localhost:8765). Designed for local-first
 * operation where the sidecar is the fast path and cloud is the sync target.
 *
 * Key differences from SulcusCloudClient:
 * - No exponential backoff / retry — local should be fast or it's down
 * - Short timeouts (2s default vs 30s for cloud)
 * - Health-aware: tracks consecutive failures and reports availability
 * - Lightweight: only implements methods needed for dual-write/local-first recall
 */

import * as http from "node:http";
import { URL } from "node:url";

/** Result of a search_memory call. */
export interface SearchResult {
  results: Record<string, unknown>[];
}

/** Result of an add_memory call. */
export interface AddResult {
  id: string;
  [key: string]: unknown;
}

/** Result of a list_hot_nodes call. */
export interface HotNodesResult {
  nodes: Record<string, unknown>[];
}

/** Extraction hints passed to add_memory (mirrors cloud client). */
export interface ExtractionHints {
  key_points?: string[];
  memory_type?: string;
  decay_class?: string;
  is_pinned?: boolean;
  min_heat?: number;
  [key: string]: unknown;
}

/** Logger interface matching the plugin API logger. */
export interface LocalClientLogger {
  info(msg: string): void;
  warn(msg: string): void;
  debug(msg: string): void;
}

/** Options for SulcusLocalClient construction. */
export interface LocalClientOptions {
  /** Local sidecar endpoint, e.g. "http://localhost:8765" */
  endpoint: string;
  /** API key for local sidecar auth (may be empty for localhost trust). */
  apiKey?: string;
  /** Request timeout in milliseconds. Default: 2000. */
  timeoutMs?: number;
  /** Max consecutive failures before marking sidecar as unavailable. Default: 3. */
  maxConsecutiveFailures?: number;
  /** Cooldown before retrying after maxConsecutiveFailures (ms). Default: 30000. */
  cooldownMs?: number;
  /** Logger instance. */
  logger?: LocalClientLogger;
}

/**
 * Lightweight HTTP client for a local Sulcus sidecar.
 *
 * Health tracking: after `maxConsecutiveFailures` consecutive errors, the client
 * enters a cooldown period and reports `isAvailable() === false`. The cooldown
 * resets on any successful request or after `cooldownMs` elapses.
 */
export class SulcusLocalClient {
  private endpoint: string;
  private apiKey: string;
  private timeoutMs: number;
  private maxConsecutiveFailures: number;
  private cooldownMs: number;
  private logger: LocalClientLogger;

  // Health tracking
  private consecutiveFailures = 0;
  private lastFailureAt = 0;
  private lastSuccessAt = 0;

  constructor(opts: LocalClientOptions) {
    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.apiKey = opts.apiKey ?? "";
    this.timeoutMs = opts.timeoutMs ?? 2000;
    this.maxConsecutiveFailures = opts.maxConsecutiveFailures ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.logger = opts.logger ?? { info: () => {}, warn: () => {}, debug: () => {} };
  }

  /**
   * Whether the local sidecar is considered available.
   * False if too many consecutive failures and cooldown hasn't elapsed.
   */
  isAvailable(): boolean {
    if (this.consecutiveFailures < this.maxConsecutiveFailures) return true;
    // Cooldown elapsed? Allow retry.
    if (Date.now() - this.lastFailureAt > this.cooldownMs) return true;
    return false;
  }

  /** Reset health state (e.g. on config change or manual intervention). */
  resetHealth(): void {
    this.consecutiveFailures = 0;
    this.lastFailureAt = 0;
  }

  /** Mark a successful request. */
  private markSuccess(): void {
    this.consecutiveFailures = 0;
    this.lastSuccessAt = Date.now();
  }

  /** Mark a failed request. */
  private markFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureAt = Date.now();
  }

  /** Health summary for diagnostics. */
  healthSummary(): { available: boolean; consecutiveFailures: number; lastSuccessAt: number; lastFailureAt: number } {
    return {
      available: this.isAvailable(),
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
    };
  }

  // ── HTTP transport ──────────────────────────────────────────────────────

  /**
   * Make an HTTP request to the local sidecar. No retries — fail fast.
   */
  private request(method: string, path: string, body?: unknown): Promise<unknown> {
    if (!this.isAvailable()) {
      return Promise.reject(new Error(`sulcus-local: sidecar unavailable (${this.consecutiveFailures} consecutive failures, cooldown active)`));
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(this.endpoint + path);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return Promise.reject(new Error(`sulcus-local: invalid URL ${this.endpoint}${path}: ${msg}`));
    }

    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }
      if (bodyStr !== undefined) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
      }

      const req = http.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : 80,
          path: parsedUrl.pathname + parsedUrl.search,
          method,
          headers,
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf-8");
            if (!res.statusCode || res.statusCode >= 400) {
              this.markFailure();
              return reject(new Error(`sulcus-local: HTTP ${res.statusCode} for ${method} ${path}: ${raw.substring(0, 200)}`));
            }
            this.markSuccess();
            if (!raw || raw.trim() === "") return resolve(null);
            try {
              resolve(JSON.parse(raw));
            } catch {
              resolve(raw);
            }
          });
        },
      );

      req.on("timeout", () => {
        req.destroy();
        this.markFailure();
        reject(new Error(`sulcus-local: timeout (${this.timeoutMs}ms) for ${method} ${path}`));
      });

      req.on("error", (e: Error) => {
        this.markFailure();
        reject(new Error(`sulcus-local: network error for ${method} ${path}: ${e.message}`));
      });

      if (bodyStr !== undefined) req.write(bodyStr);
      req.end();
    });
  }

  // ── API methods (mirror SulcusCloudClient's interface) ──────────────────

  /**
   * Search memory by semantic query.
   * Uses the same `/api/v1/agent/search` endpoint as the cloud client.
   */
  async search_memory(query: string, limit?: number, namespace?: string): Promise<SearchResult> {
    const body: Record<string, unknown> = { query };
    if (limit !== undefined) body.limit = limit;
    if (namespace !== undefined) body.namespace = namespace;
    const res = (await this.request("POST", "/api/v1/agent/search", body)) as Record<string, unknown> | null;
    const results = ((res?.results ?? res?.items ?? res?.nodes ?? (Array.isArray(res) ? res : [])) as Record<string, unknown>[]);
    return { results };
  }

  /**
   * Store a new memory node.
   * Uses the same `/api/v1/agent/nodes` endpoint as the cloud client.
   */
  async add_memory(content: string, memoryType?: string | null, hints?: ExtractionHints): Promise<AddResult> {
    const body: Record<string, unknown> = { label: content };
    if (memoryType) body.memory_type = memoryType;
    if (hints) body.extraction_hints = hints;
    const res = (await this.request("POST", "/api/v1/agent/nodes", body)) as Record<string, unknown> | null;
    return (res ?? { id: "unknown" }) as AddResult;
  }

  /**
   * Get a single memory node by ID.
   */
  async get_memory(id: string): Promise<Record<string, unknown> | null> {
    try {
      const res = (await this.request("GET", `/api/v1/agent/nodes/${id}`)) as Record<string, unknown> | null;
      return res;
    } catch {
      return null;
    }
  }

  /**
   * Update an existing memory node.
   */
  async update_memory(id: string, updates: { content?: string; label?: string; memory_type?: string; is_pinned?: boolean; current_heat?: number }): Promise<Record<string, unknown> | null> {
    const res = (await this.request("PATCH", `/api/v1/agent/nodes/${id}`, updates)) as Record<string, unknown> | null;
    return res;
  }

  /**
   * List hot nodes (most active memories).
   */
  async list_hot_nodes(limit?: number): Promise<HotNodesResult> {
    const q = limit ? `?limit=${limit}` : "";
    const res = (await this.request("GET", `/api/v1/agent/hot_nodes${q}`)) as Record<string, unknown> | unknown[] | null;
    const nodes = (Array.isArray(res) ? res : ((res as Record<string, unknown>)?.hot_nodes ?? (res as Record<string, unknown>)?.nodes ?? [])) as Record<string, unknown>[];
    return { nodes };
  }

  /**
   * Delete a memory node.
   */
  async delete_memory(id: string): Promise<unknown> {
    return this.request("DELETE", `/api/v1/agent/nodes/${id}`);
  }

  /**
   * Health probe — check if sidecar is reachable.
   * Returns true if endpoint responds, false otherwise.
   */
  async probe(): Promise<boolean> {
    try {
      await this.request("GET", "/api/v1/agent/hot_nodes?limit=1");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Batch heat boost — boost multiple nodes at once.
   */
  async boost_batch(boosts: Array<{ id: string; heat: number }>): Promise<boolean> {
    try {
      await this.request("POST", "/api/v1/agent/boost_batch", { boosts });
      return true;
    } catch {
      return false;
    }
  }
}
