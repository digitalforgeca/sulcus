/**
 * Sulcus — Thermodynamic Memory for AI Agents.
 *
 * Zero-dependency Node.js SDK. Uses native `fetch` (Node 18+).
 *
 * @example
 * ```ts
 * import { Sulcus } from "@digitalforgestudios/sulcus-sdk";
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

export interface MemoryProvenance {
  backend: string;
  server?: string;
  storage?: string;
  sync_available?: boolean;
  /** Whether the SIU ONNX classifier was active when this memory was stored. */
  siu_classified?: boolean;
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
  /** Provenance metadata — where/how this memory was stored and classified. */
  provenance?: MemoryProvenance;
  /** Whether the SIU model has been trained on this memory. */
  trained?: boolean;
  /** Number of times this memory has been recalled (v2.2+). */
  recall_count?: number;
  /** ISO timestamp of the last recall event (v2.2+). */
  last_recalled_at?: string;
  /** Interaction epoch counter used by the decay engine (v2.2+). */
  interaction_epoch?: number;
}

export interface RememberOptions {
  memoryType?: "episodic" | "semantic" | "preference" | "procedural" | "fact" | "synthesis";
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
  /** When true, auto-records training signal: "this is a valid store with this type". */
  trainOnThis?: boolean;
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
  /** When true, auto-records reclassify signal if type changed, or accept signal if not. */
  trainOnThis?: boolean;
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

export interface AclEntry {
  id: string;
  agent_id: string;
  namespace: string;
  policy: "allow" | "deny" | "default";
  created_at?: string;
}

export interface EncryptionConfig {
  enabled: boolean;
  provider?: string;
  key_vault_url?: string;
  key_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface EncryptionAuditEntry {
  id: string;
  action: string;
  actor: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface StorageStatus {
  total_nodes: number;
  total_size_bytes: number;
  namespaces: number;
  oldest_node?: string;
  newest_node?: string;
}

export interface BillingProduct {
  id: string;
  name: string;
  description?: string;
  price?: number;
  currency?: string;
  interval?: string;
  features?: string[];
}

// -- SIU v2 Types -------------------------------------------------------

export interface SiluConfig {
  siu_enabled?: boolean;
  siu_confidence_threshold?: number;
  siu_auto_reclassify?: boolean;
  silu_enabled?: boolean;
  silu_entity_extraction?: boolean;
  silu_classification?: boolean;
  silu_training_signals?: boolean;
  /** BYOK: Custom LLM endpoint URL for SILU (Azure, OpenAI, etc.) */
  silu_api_endpoint?: string;
  /** BYOK: API key for the custom endpoint. */
  silu_api_key?: string;
  /** BYOK: Model name override (default: gpt-5.4-nano). */
  silu_model?: string;
  type_overrides?: Record<string, string>;
}

export interface SiluConfigResult {
  siu_available: boolean;
  silu_available: boolean;
  /** Per-agent config with global defaults merged in. */
  effective_config: SiluConfig;
  global_defaults: SiluConfig;
  /** Whether this namespace has custom overrides vs inheriting global. */
  has_overrides: boolean;
  namespace?: string;
}

export interface SiuLabelOptions {
  /** If true, only return memory_type classification (skip store decision). */
  qualityOnly?: boolean;
}

export interface SiuLabelResult {
  memory_type: string;
  confidence: number;
  should_store: boolean;
  reasoning?: string;
  model?: string;
}

export interface SiuStatusResult {
  model: string;
  version: string;
  status: "ready" | "training" | "unavailable";
  last_trained?: string;
  training_samples?: number;
  accuracy?: number;
}

export interface SiuSignalOptions {
  memoryId: string;
  signalType: "correction" | "confirmation" | "rejection";
  predictedType?: string;
  predictedStore?: boolean;
  predictedConf?: number;
  correctedType?: string;
  correctedStore?: boolean;
  contentSnapshot?: string;
  source?: string;
  namespace?: string;
}

export interface SiuSignalResult {
  id: string;
  memory_id: string;
  signal_type: string;
  created_at: string;
}

export interface SiuSignalsOptions {
  limit?: number;
  offset?: number;
}

export interface TriggerFeedbackOptions {
  feedbackType: "positive" | "negative" | "false_positive" | "false_negative" | "correction";
  triggerId?: string;
  triggerLogId?: string;
  eventType?: string;
  memoryId?: string;
  expectedAction?: string;
  notes?: string;
  source?: string;
}

export interface TriggerFeedbackResult {
  id: string;
  feedback_type: string;
  created_at: string;
}

export interface XpProfile {
  xp: number;
  level: number;
  badges: string[];
  streak_days: number;
  last_active?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// SDK Version
// ---------------------------------------------------------------------------

const SDK_VERSION = "1.0.0";

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

const DEFAULT_URL = "https://api.sulcus.ca";
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
    if (options?.trainOnThis) body.train_on_this = true;
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
    if (options.trainOnThis) body.train_on_this = true;
    return this.patch<Memory>(`/api/v1/agent/nodes/${memoryId}`, body);
  }

  /**
   * Permanently delete a memory.
   * @param opts - Optional: set trainOnThis to record a reject signal for SIVU training.
   */
  async forget(memoryId: string, opts?: { trainOnThis?: boolean }): Promise<void> {
    const path = opts?.trainOnThis
      ? `/api/v1/agent/nodes/${memoryId}?train=true`
      : `/api/v1/agent/nodes/${memoryId}`;
    await this.del(path);
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

  // -- Sync ---------------------------------------------------------------

  /**
   * Agent sync — push a CRDT sync payload and receive the merged state.
   * Used by agent runtimes to reconcile memory state across instances.
   *
   * @param payload - Sync payload (agent_id, vector_clock, changes, etc.).
   * @returns Merged sync response from the server.
   */
  async sync(payload: Record<string, unknown>): Promise<Record<string, any>> {
    return this.post("/api/v1/agent/sync", payload);
  }

  // -- Hot Nodes ----------------------------------------------------------

  /** Return the hottest memories by current_heat (descending). */
  async hotNodes(limit = 20): Promise<Memory[]> {
    const data = await this.get<Memory[]>(`/api/v1/agent/hot_nodes?limit=${limit}`);
    return Array.isArray(data) ? data : [];
  }

  // -- Storage ------------------------------------------------------------

  /** Get storage status (node count, size, namespace breakdown). */
  async storageStatus(): Promise<StorageStatus> {
    return this.get<StorageStatus>("/api/v1/agent/storage");
  }

  // -- Bulk Delete --------------------------------------------------------

  /** Delete multiple memories by IDs, type, or namespace. Returns count deleted. */
  async bulkDelete(opts: {
    ids?: string[];
    memoryType?: string;
    namespace?: string;
  }): Promise<number> {
    const body: Record<string, any> = {};
    if (opts.ids) body.ids = opts.ids;
    if (opts.memoryType) body.memory_type = opts.memoryType;
    if (opts.namespace) body.namespace = opts.namespace;
    const result = await this.post<{ deleted: number }>("/api/v1/agent/nodes/bulk", body);
    return result?.deleted ?? 0;
  }

  // -- Account & Org ------------------------------------------------------

  /** Get tenant/org info for the current API key. */
  async whoami(): Promise<OrgInfo> {
    return this.get<OrgInfo>("/api/v1/org");
  }

  /** Update org settings (name, etc.). */
  async updateOrg(patch: Record<string, any>): Promise<Record<string, any>> {
    return this.patch("/api/v1/org", patch);
  }

  /** Invite a member to the org by email. */
  async inviteMember(
    email: string,
    role: string = "member",
  ): Promise<Record<string, any>> {
    return this.post("/api/v1/org/invite", { email, role });
  }

  /** Remove a member from the org. */
  async removeMember(userId: string): Promise<void> {
    await this.request("DELETE", "/api/v1/org/members", { user_id: userId });
  }

  /** Get storage and health metrics. */
  async metrics(): Promise<Metrics> {
    return this.get<Metrics>("/api/v1/metrics");
  }

  /** Get dashboard statistics (total nodes, heat distribution, etc.). */
  async dashboard(): Promise<Record<string, any>> {
    return this.get("/api/v1/admin/dashboard");
  }

  /** Get the memory graph visualization data (nodes + edges). */
  async graph(): Promise<Record<string, any>> {
    return this.get("/api/v1/admin/visualize/graph");
  }

  /** Get graph health/status for the current tenant. */
  async graphStatus(): Promise<Record<string, any>> {
    return this.get("/api/v1/agent/graph/status");
  }

  /**
   * Get graph neighbors for a memory node.
   *
   * @param id - UUID of the memory node.
   */
  async graphNeighbors(id: string): Promise<Record<string, any>> {
    return this.get(`/api/v1/agent/graph/neighbors/${id}`);
  }

  /**
   * Verify graph integrity for a memory node.
   *
   * @param id - UUID of the memory node.
   */
  async graphVerify(id: string): Promise<Record<string, any>> {
    return this.get(`/api/v1/agent/graph/verify/${id}`);
  }

  // -- Admin: Invites & Usage --------------------------------------------

  /**
   * Generate an invite token (admin only).
   *
   * @param email - Email to invite.
   * @param role - Role to assign (default: 'member').
   */
  async createInvite(email: string, role: string = "member"): Promise<Record<string, any>> {
    return this.post("/api/v1/admin/invite", { email, role });
  }

  /**
   * Send an invite email for a previously created invite token (admin only).
   *
   * @param inviteToken - Token returned from createInvite.
   */
  async sendInvite(inviteToken: string): Promise<Record<string, any>> {
    return this.post("/api/v1/admin/invite/send", { token: inviteToken });
  }

  /**
   * Create a platform-level invite (multi-tenant admin only).
   *
   * @param payload - Platform invite config (email, plan, metadata, etc.).
   */
  async platformInvite(payload: Record<string, any>): Promise<Record<string, any>> {
    return this.post("/api/v1/admin/invite/platform", payload);
  }

  /** Get usage statistics for the current billing period (admin only). */
  async usage(): Promise<Record<string, any>> {
    return this.get("/api/v1/admin/usage");
  }

  /** Get telemetry statistics (admin only). */
  async telemetryStats(): Promise<Record<string, any>> {
    return this.get("/api/v1/admin/telemetry");
  }

  /** List registered users on the waitlist (admin only). */
  async listWaitlist(limit = 50, cursor?: string): Promise<Record<string, any>> {
    let path = `/api/v1/admin/waitlist?limit=${limit}`;
    if (cursor) path += `&cursor=${cursor}`;
    return this.get(path);
  }

  // -- API Keys -----------------------------------------------------------

  /** List all API keys for the current tenant. */
  async listKeys(): Promise<Record<string, any>[]> {
    const data = await this.get<any>("/api/v1/keys");
    return Array.isArray(data) ? data : data.keys ?? [];
  }

  /** Create a new API key. Returns the key (shown only once). */
  async createKey(name: string = ""): Promise<Record<string, any>> {
    return this.post("/api/v1/keys", { name });
  }

  /** Revoke an API key permanently. */
  async revokeKey(keyId: string): Promise<void> {
    await this.del(`/api/v1/keys/${keyId}`);
  }

  // -- Namespace ACL ------------------------------------------------------

  /**
   * List all namespace ACL entries for the current tenant.
   *
   * ACL entries control which agent IDs can access which namespaces,
   * and with what policy (allow/deny/default).
   */
  async listAcl(): Promise<AclEntry[]> {
    const data = await this.get<any>("/api/v1/namespaces/acl");
    return Array.isArray(data) ? data : data.items ?? data.acl ?? [];
  }

  /**
   * Create or update a namespace ACL entry.
   *
   * @param agentId - The agent identifier this rule applies to.
   * @param namespace - The namespace to control access for.
   * @param policy - 'allow', 'deny', or 'default'.
   */
  async upsertAcl(
    agentId: string,
    namespace: string,
    policy: "allow" | "deny" | "default",
  ): Promise<AclEntry> {
    return this.post<AclEntry>("/api/v1/namespaces/acl", {
      agent_id: agentId,
      namespace,
      policy,
    });
  }

  /**
   * Delete a namespace ACL entry by ID.
   *
   * @param aclId - The ACL entry UUID to remove.
   */
  async deleteAcl(aclId: string): Promise<void> {
    await this.del(`/api/v1/namespaces/acl/${aclId}`);
  }

  /**
   * Set the default namespace for the current tenant.
   *
   * @param namespace - The namespace slug to set as default.
   */
  async setDefaultNamespace(namespace: string): Promise<Record<string, any>> {
    return this.put("/api/v1/namespaces/default", { namespace });
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

  /** Get the thermodynamic engine configuration (v2.2 alias for getThermoConfig). */
  async getThermo(): Promise<Record<string, any>> {
    return this.get("/api/v1/settings/thermo");
  }

  /**
   * Update the thermodynamic engine configuration (v2.2 alias for setThermoConfig).
   *
   * @param config - Partial or full ThermoConfig to apply.
   */
  async updateThermo(config: Record<string, unknown>): Promise<Record<string, any>> {
    return this.patch("/api/v1/settings/thermo", config);
  }

  // -- Encryption (Enterprise — CMK via Azure Key Vault) ------------------

  /**
   * Get the current encryption configuration (enterprise only).
   *
   * Returns the CMK (Customer-Managed Key) configuration if configured.
   */
  async getEncryptionConfig(): Promise<EncryptionConfig> {
    return this.get<EncryptionConfig>("/api/v1/settings/encryption");
  }

  /**
   * Configure customer-managed encryption (enterprise only).
   *
   * @param config - Encryption config (key_vault_url, key_name, provider, etc.).
   */
  async configureEncryption(config: Record<string, unknown>): Promise<EncryptionConfig> {
    return this.put<EncryptionConfig>("/api/v1/settings/encryption", config);
  }

  /**
   * Revoke the current encryption configuration (enterprise only).
   *
   * Warning: This disables CMK encryption. Data remains encrypted at rest
   * but reverts to platform-managed keys.
   */
  async revokeEncryption(): Promise<void> {
    await this.del("/api/v1/settings/encryption");
  }

  /**
   * Validate an encryption configuration without applying it (enterprise only).
   *
   * @param config - Encryption config to validate.
   * @returns Validation result with ok status and any error messages.
   */
  async validateEncryption(config: Record<string, unknown>): Promise<{
    ok: boolean;
    errors?: string[];
  }> {
    return this.post("/api/v1/settings/encryption/validate", config);
  }

  /**
   * Get the encryption audit log (enterprise only).
   *
   * Returns a history of key rotation, configuration changes, and access events.
   */
  async encryptionAuditLog(limit = 50): Promise<EncryptionAuditEntry[]> {
    const data = await this.get<any>(`/api/v1/settings/encryption/audit?limit=${limit}`);
    return Array.isArray(data) ? data : data.items ?? [];
  }

  // -- Memory Status & Consolidation -------------------------------------

  /**
   * Get full memory status: backend info, capabilities, and namespace stats.
   *
   * Returns SIU classification status, semantic search availability,
   * memory counts, and capability flags.
   */
  async memoryStatus(): Promise<{
    backend: string;
    namespace: string;
    stats: {
      namespace_memories: number;
      total_memories: number;
      [key: string]: unknown;
    };
    capabilities: {
      siu_classification: boolean;
      semantic_search: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }> {
    return this.get("/api/v1/agent/memory/status");
  }

  /**
   * Get consolidation candidates — groups of related memories that could be merged.
   *
   * @param limit - Maximum number of candidate groups to return (default: 10).
   */
  async consolidationCandidates(limit = 10): Promise<Record<string, any>[]> {
    const data = await this.get<any>(`/api/v1/agent/consolidation-candidates?limit=${limit}`);
    return Array.isArray(data) ? data : data.candidates ?? data.groups ?? [];
  }

  /**
   * Fold (merge/consolidate) two or more memories into one.
   *
   * @param memoryIds - Array of memory UUIDs to fold together.
   * @param options - Optional label, type override, or metadata for the merged node.
   */
  async fold(
    memoryIds: string[],
    options?: {
      label?: string;
      memoryType?: string;
      metadata?: Record<string, any>;
    },
  ): Promise<Record<string, any>> {
    const body: Record<string, any> = { node_ids: memoryIds };
    if (options?.label) body.label = options.label;
    if (options?.memoryType) body.memory_type = options.memoryType;
    if (options?.metadata) body.metadata = options.metadata;
    return this.post("/api/v1/agent/fold", body);
  }

  /**
   * Trigger embedding backfill for memories that lack vector embeddings.
   *
   * Useful after migration or bulk import. The server processes in the background.
   *
   * @param options - Optional filters: namespace, limit, memoryType.
   */
  async backfillEmbeddings(
    options?: {
      namespace?: string;
      limit?: number;
      memoryType?: string;
    },
  ): Promise<{ queued: number; message: string }> {
    const body: Record<string, any> = {};
    if (options?.namespace) body.namespace = options.namespace;
    if (options?.limit) body.limit = options.limit;
    if (options?.memoryType) body.memory_type = options.memoryType;
    return this.post("/api/v1/agent/backfill-embeddings", body);
  }

  /**
   * Download the SIU (Semantic Intent Unit) classifier model.
   *
   * Returns the JSON model weights used for client-side memory classification.
   * Platform-independent, ~56KB, pure inference in JS/TS.
   */
  async getSiuModel(): Promise<Record<string, any>> {
    return this.get("/api/v1/agent/siu-model");
  }

  // -- Extensions ---------------------------------------------------------

  /**
   * Get extension sync state for the current agent/browser session.
   *
   * Returns the current memory snapshot and sync token for the
   * Sulcus browser extension.
   */
  async extensionSync(): Promise<Record<string, any>> {
    return this.get("/api/v1/extensions/sync");
  }

  // -- Feedback & Analytics -----------------------------------------------

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

  // -- XP / Gamification Profile -----------------------------------------

  /**
   * Get the XP profile (level, badges, streaks).
   *
   * This is the primary path. The legacy `/gamification/profile` route
   * is also available via `profileLegacy()`.
   */
  async xpProfile(): Promise<XpProfile> {
    return this.get<XpProfile>("/api/v1/xp");
  }

  /**
   * Get the gamification profile via the legacy route.
   *
   * @deprecated Use `xpProfile()` instead.
   */
  async profile(): Promise<XpProfile> {
    return this.get<XpProfile>("/api/v1/gamification/profile");
  }

  // -- Activity -----------------------------------------------------------

  /** Get the activity log for your tenant. */
  async activity(limit = 50, cursor?: string): Promise<{
    items: Array<{
      id: number;
      actor: string;
      action: string;
      target_id: string | null;
      target_label: string | null;
      metadata: any;
      created_at: string;
    }>;
    next_cursor: string | null;
  }> {
    let params = `?limit=${limit}`;
    if (cursor) params += `&cursor=${cursor}`;
    return this.get(`/api/v1/activity${params}`);
  }

  /** Record a custom activity event. */
  async recordActivity(
    action: string,
    opts: {
      targetId?: string;
      targetLabel?: string;
      metadata?: Record<string, any>;
    } = {},
  ): Promise<Record<string, any>> {
    const body: Record<string, any> = { action };
    if (opts.targetId) body.target_id = opts.targetId;
    if (opts.targetLabel) body.target_label = opts.targetLabel;
    if (opts.metadata) body.metadata = opts.metadata;
    return this.post("/api/v1/activity", body);
  }

  // -- Triggers -----------------------------------------------------------

  /** List all active memory triggers. */
  async listTriggers(): Promise<Record<string, any>[]> {
    const data = await this.get<Record<string, any>>("/api/v1/triggers");
    return (data as any).items ?? (data as any).triggers ?? [];
  }

  /**
   * Create a reactive trigger on the memory graph.
   *
   * @param event - What fires: on_store, on_recall, on_decay, on_boost, on_relate, on_threshold
   * @param action - What happens: notify, boost, pin, tag, deprecate, webhook
   * @param opts - name, description, actionConfig, filters, maxFires, cooldownSeconds
   */
  async createTrigger(
    event: string,
    action: string,
    opts: {
      name?: string;
      description?: string;
      actionConfig?: Record<string, any>;
      filterMemoryType?: string;
      filterNamespace?: string;
      filterLabelPattern?: string;
      filterHeatBelow?: number;
      filterHeatAbove?: number;
      maxFires?: number;
      cooldownSeconds?: number;
    } = {},
  ): Promise<Record<string, any>> {
    const body: Record<string, any> = { event, action };
    if (opts.name) body.name = opts.name;
    if (opts.description) body.description = opts.description;
    if (opts.actionConfig) body.action_config = opts.actionConfig;
    if (opts.filterMemoryType) body.filter_memory_type = opts.filterMemoryType;
    if (opts.filterNamespace) body.filter_namespace = opts.filterNamespace;
    if (opts.filterLabelPattern) body.filter_label_pattern = opts.filterLabelPattern;
    if (opts.filterHeatBelow !== undefined) body.filter_heat_below = opts.filterHeatBelow;
    if (opts.filterHeatAbove !== undefined) body.filter_heat_above = opts.filterHeatAbove;
    if (opts.maxFires !== undefined) body.max_fires = opts.maxFires;
    if (opts.cooldownSeconds) body.cooldown_seconds = opts.cooldownSeconds;
    return this.post("/api/v1/triggers", body);
  }

  /** Update a trigger. Pass any fields to change. */
  async updateTrigger(
    triggerId: string,
    patch: Record<string, any>,
  ): Promise<Record<string, any>> {
    return this.patch(`/api/v1/triggers/${triggerId}`, patch);
  }

  /** Delete a trigger and its history. */
  async deleteTrigger(triggerId: string): Promise<void> {
    await this.del(`/api/v1/triggers/${triggerId}`);
  }

  /** Get trigger firing history. */
  async triggerHistory(limit = 50): Promise<Record<string, any>[]> {
    const data = await this.get<Record<string, any>>(
      `/api/v1/triggers/history?limit=${limit}`,
    );
    return (data as any).items ?? (data as any).history ?? [];
  }

  // -- SIU v2 — Intelligent Classification --------------------------------

  /**
   * Classify text using the SIU v2 model.
   *
   * Returns the predicted memory type, confidence score, and whether
   * the text should be stored as a memory.
   *
   * @param text - The text to classify.
   * @param opts - Optional: qualityOnly skips the store/discard decision.
   */
  async siuLabel(
    text: string,
    opts?: SiuLabelOptions,
  ): Promise<SiuLabelResult> {
    const body: Record<string, unknown> = { text };
    if (opts?.qualityOnly) body.quality_only = true;
    return this.post<SiuLabelResult>("/api/v2/siu/label", body);
  }

  /**
   * Get SIU model status (version, training state, accuracy).
   */
  async siuStatus(): Promise<SiuStatusResult> {
    return this.get<SiuStatusResult>("/api/v2/siu/status");
  }

  /**
   * Trigger a SIU model retrain.
   *
   * @param model - Optional model identifier to retrain on.
   */
  async siuRetrain(model?: string): Promise<Record<string, any>> {
    const body: Record<string, unknown> = {};
    if (model) body.model = model;
    return this.post("/api/v2/siu/retrain", body);
  }

  // -- SIU v2 — Training Signals ------------------------------------------

  /**
   * Record a training signal (correction or confirmation) for SIU.
   *
   * Used to build the feedback loop: when the SIU prediction is wrong,
   * submit a correction signal so the next retrain improves.
   *
   * @param opts - Signal details (memoryId, signalType, predicted/corrected values).
   */
  async siuSignal(opts: SiuSignalOptions): Promise<SiuSignalResult> {
    const body: Record<string, unknown> = {
      memory_id: opts.memoryId,
      signal_type: opts.signalType,
    };
    if (opts.predictedType !== undefined) body.predicted_type = opts.predictedType;
    if (opts.predictedStore !== undefined) body.predicted_store = opts.predictedStore;
    if (opts.predictedConf !== undefined) body.predicted_conf = opts.predictedConf;
    if (opts.correctedType !== undefined) body.corrected_type = opts.correctedType;
    if (opts.correctedStore !== undefined) body.corrected_store = opts.correctedStore;
    if (opts.contentSnapshot !== undefined) body.content_snapshot = opts.contentSnapshot;
    if (opts.source !== undefined) body.source = opts.source;
    if (opts.namespace !== undefined) body.namespace = opts.namespace;
    return this.post<SiuSignalResult>("/api/v2/siu/signal", body);
  }

  /**
   * List training signals with pagination.
   *
   * @param opts - Optional limit and offset.
   */
  async siuSignals(opts?: SiuSignalsOptions): Promise<Record<string, any>[]> {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    const data = await this.get<any>(
      `/api/v2/siu/signals?limit=${limit}&offset=${offset}`,
    );
    return Array.isArray(data) ? data : (data.items ?? data.signals ?? []);
  }

  // -- SILU Config (per-agent intelligence tuning) -------------------------

  /**
   * Get the effective SILU/SIU configuration for a namespace (agent).
   * Returns global defaults merged with any per-agent overrides.
   *
   * @param namespace - The agent namespace (e.g. "daedalus").
   */
  async getSiluConfig(namespace?: string): Promise<SiluConfigResult> {
    const path = namespace
      ? `/api/v1/settings/siu/${encodeURIComponent(namespace)}`
      : "/api/v1/settings/siu";
    return this.get<SiluConfigResult>(path);
  }

  /**
   * Update SILU/SIU configuration for a namespace (agent).
   * Supports BYOK: set silu_api_endpoint, silu_api_key, silu_model
   * to use your own LLM for the SILU pipeline.
   *
   * @param namespace - The agent namespace to configure.
   * @param config - Partial config to merge (only provided fields are updated).
   */
  async updateSiluConfig(
    namespace: string,
    config: Partial<SiluConfig>,
  ): Promise<{ ok: boolean }> {
    return this.patch<{ ok: boolean }>(
      `/api/v1/settings/siu/${encodeURIComponent(namespace)}`,
      config,
    );
  }

  /**
   * Reset a namespace's SILU config to global defaults (removes all overrides).
   *
   * @param namespace - The agent namespace to reset.
   */
  /**
   * Reset a namespace's SILU config to global defaults.
   * Sets all fields to empty/default, effectively removing overrides.
   *
   * @param namespace - The agent namespace to reset.
   */
  async resetSiluConfig(
    namespace: string,
  ): Promise<{ ok: boolean }> {
    // PATCH with explicit defaults to clear overrides
    return this.patch<{ ok: boolean }>(
      `/api/v1/settings/siu/${encodeURIComponent(namespace)}`,
      {
        siu_enabled: null, siu_confidence_threshold: null, siu_auto_reclassify: null,
        silu_enabled: null, silu_entity_extraction: null, silu_classification: null,
        silu_training_signals: null, silu_api_endpoint: null, silu_api_key: null,
        silu_model: null, type_overrides: null,
      },
    );
  }

  // -- Trigger Feedback (SITU training) -----------------------------------

  /**
   * Submit feedback on a trigger firing for SITU training.
   *
   * Use this to tell the system whether a trigger fired correctly,
   * was a false positive, or missed an expected action.
   *
   * @param opts - Feedback details.
   */
  async triggerFeedback(
    opts: TriggerFeedbackOptions,
  ): Promise<TriggerFeedbackResult> {
    const body: Record<string, unknown> = {
      feedback_type: opts.feedbackType,
    };
    if (opts.triggerId !== undefined) body.trigger_id = opts.triggerId;
    if (opts.triggerLogId !== undefined) body.trigger_log_id = opts.triggerLogId;
    if (opts.eventType !== undefined) body.event_type = opts.eventType;
    if (opts.memoryId !== undefined) body.memory_id = opts.memoryId;
    if (opts.expectedAction !== undefined) body.expected_action = opts.expectedAction;
    if (opts.notes !== undefined) body.notes = opts.notes;
    if (opts.source !== undefined) body.source = opts.source;
    return this.post<TriggerFeedbackResult>("/api/v1/triggers/feedback", body);
  }

  /**
   * List trigger feedback entries.
   *
   * @param limit - Maximum entries to return (default 50).
   */
  async listTriggerFeedback(limit = 50): Promise<Record<string, any>[]> {
    const data = await this.get<any>(
      `/api/v1/triggers/feedback?limit=${limit}`,
    );
    return Array.isArray(data) ? data : (data.items ?? data.feedback ?? []);
  }

  // -- Billing ------------------------------------------------------------

  /**
   * Create a Stripe checkout session (redirects to payment page).
   *
   * @param priceId - Stripe price ID for the plan.
   * @param successUrl - URL to redirect to after successful checkout.
   * @param cancelUrl - URL to redirect to if checkout is cancelled.
   */
  async createCheckoutSession(
    priceId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ url: string; session_id: string }> {
    return this.post("/api/v1/billing/create-checkout-session", {
      price_id: priceId,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
  }

  /**
   * Create a Stripe subscription directly (for server-side billing flows).
   *
   * @param payload - Subscription parameters (price_id, payment_method_id, etc.).
   */
  async createSubscription(payload: Record<string, unknown>): Promise<Record<string, any>> {
    return this.post("/api/v1/billing/create-subscription", payload);
  }

  /**
   * Create a Stripe customer portal session (manage subscription/invoices).
   *
   * @param returnUrl - URL to return to after the portal session.
   */
  async createPortalSession(returnUrl: string): Promise<{ url: string }> {
    return this.post("/api/v1/billing/create-portal-session", {
      return_url: returnUrl,
    });
  }

  /**
   * Get available billing products/plans (no auth required).
   *
   * Returns the list of available subscription tiers with pricing.
   */
  async getProducts(): Promise<BillingProduct[]> {
    const data = await this.get<any>("/api/v1/billing/products");
    return Array.isArray(data) ? data : data.products ?? [];
  }

  // -- Auth ----------------------------------------------------------------

  /**
   * Validate the current API key and return identity, tier, and limits.
   *
   * Use this to test key validity before configuring plugins or running sync.
   * Returns `authenticated: true` with tenant info on success, or throws on 401.
   */
  async verify(): Promise<{
    authenticated: boolean;
    tenant_id: string;
    plan_tier: string;
    agent_label: string | null;
    limits: {
      ops_per_month: number | "unlimited";
      max_nodes: number | "unlimited";
      max_agents: number | null;
      max_sync_requests: number | "unlimited";
    };
    features: string;
  }> {
    return this.get("/api/v1/auth/verify");
  }

  // -- Public Endpoints (no auth required) --------------------------------

  /**
   * Get the public status of the Sulcus service.
   *
   * Suitable for health checks and status pages — does not require auth.
   */
  async status(): Promise<{
    status: "ok" | "degraded" | "down";
    version?: string;
    [key: string]: unknown;
  }> {
    return this.get("/api/v1/status");
  }

  /**
   * Register a new account (public — no auth required).
   *
   * @param payload - Registration details (email, password, org_name, etc.).
   */
  async join(payload: Record<string, unknown>): Promise<Record<string, any>> {
    return this.post("/api/v1/admin/join", payload);
  }

  /**
   * Join the Sulcus waitlist (public — no auth required).
   *
   * @param email - Email address to register on the waitlist.
   * @param metadata - Optional extra data (source, use_case, etc.).
   */
  async joinWaitlist(
    email: string,
    metadata?: Record<string, unknown>,
  ): Promise<Record<string, any>> {
    const body: Record<string, unknown> = { email };
    if (metadata) body.metadata = metadata;
    return this.post("/api/v1/waitlist", body);
  }

  /**
   * Submit telemetry data (public — no auth required).
   *
   * Used by SDKs and extensions to report usage metrics.
   * @param payload - Telemetry payload.
   */
  async ingestTelemetry(payload: Record<string, unknown>): Promise<void> {
    await this.post("/api/v1/telemetry", payload);
  }

  // -- HTTP primitives ----------------------------------------------------

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": `sulcus-node/${SDK_VERSION}`,
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
  private put<T>(path: string, body: unknown) {
    return this.request<T>("PUT", path, body);
  }
  private del(path: string) {
    return this.request<void>("DELETE", path);
  }
}

export default Sulcus;
