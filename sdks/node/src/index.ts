/**
 * Sulcus — Thermodynamic Memory for AI Agents.
 *
 * Zero-dependency Node.js SDK. Uses native `fetch` (Node 18+).
 *
 * @example
 * ```ts
 * import { Sulcus } from "sulcus";
 *
 * const client = new Sulcus({ apiKey: "sk-..." });
 * await client.remember("User prefers dark mode", { memoryType: "preference" });
 * const results = await client.search("dark mode");
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SulcusConfig {
  /** Sulcus API key (sk-... format or legacy token). */
  apiKey: string;
  /** Server URL. Defaults to Sulcus Cloud. */
  baseUrl?: string;
  /** Default namespace for operations. */
  namespace?: string;
  /** Request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
}

export interface Memory {
  id: string;
  /** The memory content. May be returned as `label` in some endpoints. */
  pointer_summary: string;
  /** Raw label field — same as pointer_summary, use pointer_summary. */
  label?: string;
  memory_type: string;
  /** Heat level. May be returned as `heat` in some endpoints. */
  current_heat: number;
  heat?: number;
  base_utility: number;
  is_pinned: boolean;
  modality: string;
  namespace: string;
}

export interface RememberOptions {
  memoryType?: "episodic" | "semantic" | "preference" | "procedural" | "moment";
  heat?: number;
  namespace?: string;
  /** Decay speed override: 'fast', 'normal', 'slow', 'glacial'. */
  decayClass?: "fast" | "normal" | "slow" | "glacial";
  /** Pin to prevent decay entirely. */
  isPinned?: boolean;
  /** Floor heat — memory never decays below this (0.0–1.0). */
  minHeat?: number;
  /** Key takeaways as structured metadata for better recall. */
  keyPoints?: string[];
}

export interface SearchOptions {
  limit?: number;
  memoryType?: string;
  namespace?: string;
}

export interface ListOptions {
  page?: number;
  pageSize?: number;
  memoryType?: string;
  namespace?: string;
  pinned?: boolean;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
}

export interface UpdateOptions {
  label?: string;
  memoryType?: string;
  isPinned?: boolean;
  namespace?: string;
  heat?: number;
}

export interface BulkUpdateOptions {
  label?: string;
  memoryType?: string;
  isPinned?: boolean;
  namespace?: string;
  heat?: number;
}

export interface BulkUpdateResult {
  updated: number;
  errors: string[];
}

export interface OrgInfo {
  tenant_id: string;
  org_name: string | null;
  plan_tier: string;
  ops_limit: number;
  nodes_limit: number;
  max_seats: number | null;
  seats_used: number;
  features: string;
}

export interface Metrics {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class SulcusError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`SulcusError(${status}): ${body}`);
    this.name = "SulcusError";
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const DEFAULT_URL = "https://server.sulcus.dforge.ca";
const DEFAULT_TIMEOUT = 30_000;

export class Sulcus {
  private apiKey: string;
  private baseUrl: string;
  private namespace: string;
  private timeoutMs: number;

  constructor(config: SulcusConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_URL).replace(/\/+$/, "");
    this.namespace = config.namespace ?? "default";
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  // -- Core API -----------------------------------------------------------

  /**
   * Store a memory.
   *
   * @param content - Text to remember (stored as pointer_summary).
   * @param options - Memory type, heat, namespace.
   * @returns The created Memory node.
   */
  async remember(content: string, options?: RememberOptions): Promise<Memory> {
    const body: Record<string, unknown> = {
      label: content,
      memory_type: options?.memoryType ?? "episodic",
      heat: options?.heat ?? 0.8,
      namespace: options?.namespace ?? this.namespace,
    };
    if (options?.decayClass) body.decay_class = options.decayClass;
    if (options?.isPinned) body.is_pinned = true;
    if (options?.minHeat !== undefined) body.min_heat = options.minHeat;
    if (options?.keyPoints) body.key_points = options.keyPoints;
    return this.post<Memory>("/api/v1/agent/nodes", body);
  }

  /**
   * Search memories by text.
   *
   * @param query - Search text (case-insensitive substring match).
   * @param options - Limit, type filter, namespace filter.
   * @returns Matching nodes sorted by heat.
   */
  async search(query: string, options?: SearchOptions): Promise<Memory[]> {
    const body: Record<string, unknown> = {
      query,
      limit: options?.limit ?? 20,
    };
    if (options?.memoryType) body.memory_type = options.memoryType;
    if (options?.namespace) body.namespace = options.namespace;
    return this.post<Memory[]>("/api/v1/agent/search", body);
  }

  /**
   * List memories with pagination and filters.
   *
   * @param options - Page, pageSize, type filter, namespace filter, search, sort.
   * @returns Memory nodes sorted by heat (descending) by default.
   */
  async list(options?: ListOptions): Promise<Memory[]> {
    const params = new URLSearchParams();
    params.set("page", String(options?.page ?? 1));
    params.set("page_size", String(options?.pageSize ?? 25));
    params.set("sort", options?.sort ?? "current_heat");
    params.set("order", options?.order ?? "desc");
    if (options?.memoryType) params.set("memory_type", options.memoryType);
    if (options?.namespace) params.set("namespace", options.namespace);
    if (options?.pinned !== undefined) params.set("pinned", String(options.pinned));
    if (options?.search) params.set("search", options.search);
    const data = await this.get<Memory[] | { nodes?: Memory[]; items?: Memory[] }>(
      `/api/v1/agent/nodes?${params}`
    );
    return Array.isArray(data) ? data : (data.nodes ?? data.items ?? []);
  }

  /** Get a single memory by ID. */
  async getMemory(memoryId: string): Promise<Memory> {
    return this.get<Memory>(`/api/v1/agent/nodes/${memoryId}`);
  }

  /**
   * Update fields on a memory.
   * Only provided fields are changed.
   */
  async update(memoryId: string, options: UpdateOptions): Promise<Memory> {
    const body: Record<string, unknown> = {};
    if (options.label !== undefined) body.label = options.label;
    if (options.memoryType !== undefined) body.memory_type = options.memoryType;
    if (options.isPinned !== undefined) body.is_pinned = options.isPinned;
    if (options.namespace !== undefined) body.namespace = options.namespace;
    if (options.heat !== undefined) body.current_heat = options.heat;
    return this.patch<Memory>(`/api/v1/agent/nodes/${memoryId}`, body);
  }

  /** Permanently delete a memory. */
  async forget(memoryId: string): Promise<void> {
    await this.del(`/api/v1/agent/nodes/${memoryId}`);
  }

  /** Pin a memory (prevents heat decay). */
  async pin(memoryId: string): Promise<Memory> {
    return this.update(memoryId, { isPinned: true });
  }

  /** Unpin a memory (resumes heat decay). */
  async unpin(memoryId: string): Promise<Memory> {
    return this.update(memoryId, { isPinned: false });
  }

  /**
   * Apply the same update to multiple memories at once.
   *
   * @param ids - List of memory UUIDs to update.
   * @param options - Fields to update on all memories.
   * @returns Count of updated memories and any errors.
   */
  async bulkUpdate(ids: string[], options: BulkUpdateOptions): Promise<BulkUpdateResult> {
    const body: Record<string, unknown> = { ids };
    if (options.label !== undefined) body.label = options.label;
    if (options.memoryType !== undefined) body.memory_type = options.memoryType;
    if (options.isPinned !== undefined) body.is_pinned = options.isPinned;
    if (options.namespace !== undefined) body.namespace = options.namespace;
    if (options.heat !== undefined) body.current_heat = options.heat;
    return this.post<BulkUpdateResult>("/api/v1/agent/nodes/bulk-patch", body);
  }

  // -- Account ------------------------------------------------------------

  /** Get tenant/org info for the current API key. */
  async whoami(): Promise<OrgInfo> {
    return this.get<OrgInfo>("/api/v1/org");
  }

  /** Get storage and health metrics. */
  async metrics(): Promise<Metrics> {
    return this.get<Metrics>("/api/v1/metrics");
  }

  // -- Thermodynamic Engine -----------------------------------------------

  /** Get the current thermodynamic engine configuration. */
  async getThermoConfig(): Promise<{
    config: Record<string, unknown>;
    defaults: Record<string, unknown>;
    custom: boolean;
  }> {
    return this.get("/api/v1/settings/thermo");
  }

  /** Update the thermodynamic engine configuration. */
  async setThermoConfig(
    config: Record<string, unknown>
  ): Promise<{ ok: boolean; config: Record<string, unknown> }> {
    return this.patch("/api/v1/settings/thermo", config);
  }

  /**
   * Send recall quality feedback for a memory node.
   *
   * @param memoryId - UUID of the memory node
   * @param signal - 'relevant' | 'irrelevant' | 'outdated'
   */
  async feedback(
    memoryId: string,
    signal: "relevant" | "irrelevant" | "outdated"
  ): Promise<{
    ok: boolean;
    node_id: string;
    heat_before: number;
    heat_after: number;
    stability_before: number;
    stability_after: number;
  }> {
    return this.post("/api/v1/feedback", {
      node_id: memoryId,
      signal,
    });
  }

  /**
   * Get recall quality analytics with tuning suggestions.
   *
   * Returns per-type relevance ratios, signal counts, and half-life
   * adjustment suggestions based on recall feedback patterns.
   */
  async recallAnalytics(): Promise<{
    stats: Array<{
      memory_type: string;
      total_recalls: number;
      relevant_count: number;
      irrelevant_count: number;
      outdated_count: number;
      relevance_ratio: number;
      avg_heat_before: number;
      avg_heat_after: number;
    }>;
    suggestions: string[];
    period: string;
  }> {
    return this.get("/api/v1/analytics/recall");
  }

  // -- HTTP primitives ----------------------------------------------------

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "sulcus-node/0.1.0",
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const resp = await fetch(url, {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new SulcusError(resp.status, text);
      }

      const text = await resp.text();
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private get<T>(path: string) {
    return this.request<T>("GET", path);
  }
  private post<T>(path: string, body: unknown) {
    return this.request<T>("POST", path, body);
  }
  private patch<T>(path: string, body: unknown) {
    return this.request<T>("PATCH", path, body);
  }
  private del(path: string) {
    return this.request<void>("DELETE", path);
  }
}

export default Sulcus;
