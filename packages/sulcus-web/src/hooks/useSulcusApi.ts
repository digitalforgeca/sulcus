import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivityItem {
  id: number;
  actor: string;
  action: string;
  target_id?: string;
  target_label?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface ActivityFilters {
  limit?: number;
  actor?: string;
  action?: string;
  before?: string;
}

export interface GamificationProfile {
  total_xp: number;
  level: number;
  level_name: string;
  next_level_xp: number;
  progress_pct: number;
  badges: string[];
  recent_xp: Array<{ reason: string; xp: number; created_at: string }>;
}

export interface ApiKey {
  id: string;
  label: string;
  prefix: string;
  plan_tier: string;
  created_at: string;
  last_used_at: string | null;
}

export interface MemoryNode {
  id: string;
  label: string;
  memory_type: string;
  heat: number;
  base_utility: number;
  is_pinned: boolean;
  modality: string;
  namespace: string;
  updated_at: string;
}

export interface PaginatedMemories {
  items: MemoryNode[];
  total: number;
  page: number;
  page_size: number;
}

export interface MemoryFilters {
  page?: number;
  page_size?: number;
  memory_type?: string;
  namespace?: string;
  pinned?: string;
  search?: string;
  sort?: string;
  order?: string;
  graph_limit?: number;
  graph_namespace?: string;
}

export interface GraphNode {
  id: string;
  label: string;
  memory_type: string;
  heat: number;
  namespace?: string;
  // d3-force adds these at runtime
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  weight: number;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  links: GraphLink[];
  total_nodes?: number;
}

export interface UsageData {
  month: string;
  sync_requests: number;
  nodes_added: number;
  avg_latency_ms: number;
  max_latency_ms: number;
}

// ---- Thermodynamics ----

export interface DecayProfile {
  half_life_secs: number;
  half_life_interactions: number;
  floor: number;
  stability_gain: number;
  reinforce_on_recall: number;
}

export interface ThermoConfig {
  decay_mode: 'Time' | 'Interaction' | 'Hybrid';
  decay_profiles: Record<string, DecayProfile>;
  recall: {
    similarity_weight: number;
    heat_weight: number;
  };
  resonance: {
    spread_factor: number;
    damping: number;
    depth: number;
    thermal_gate: number;
  };
  tick: {
    mode: string;
    trigger_ops: number;
    max_idle_ms: number;
  };
  consolidation: {
    cold_threshold: number;
    cold_count_trigger: number;
    strategy: string;
  };
  active_index: {
    hot_threshold: number;
    cold_threshold: number;
    max_nodes: number;
    context_budget_chars: number;
  };
  reinforcement: {
    on_recall: number;
    on_update: number;
    on_edge_access: number;
    stability_gain: number;
  };
}

export interface ThermoResponse {
  config: ThermoConfig;
  custom: boolean;
  defaults: ThermoConfig;
}

export interface RecallStat {
  memory_type: string;
  total_recalls: number;
  relevant_count: number;
  irrelevant_count: number;
  outdated_count: number;
  relevance_ratio: number;
  avg_heat_before: number;
  avg_heat_after: number;
}

export interface RecallAnalytics {
  period: string;
  stats: RecallStat[];
  suggestions: string[];
}

// ---- Triggers ----

export interface Trigger {
  id: string;
  namespace: string;
  name: string;
  description: string;
  enabled: boolean;
  event: string;
  action: string;
  action_config: Record<string, unknown>;
  filters: {
    memory_type: string | null;
    namespace: string | null;
    label_pattern: string | null;
    heat_below: number | null;
    heat_above: number | null;
  };
  max_fires: number | null;
  fire_count: number;
  cooldown_seconds: number;
  last_fired_at: string | null;
  created_at: string;
}

export interface TriggerLogEntry {
  id: string;
  trigger_id: string;
  event: string;
  node_id: string | null;
  action: string;
  result: Record<string, unknown>;
  fired_at: string;
}

export interface CreateTriggerInput {
  name: string;
  description?: string;
  event: string;
  action: string;
  action_config?: Record<string, unknown>;
  filter_memory_type?: string;
  filter_namespace?: string;
  filter_label_pattern?: string;
  filter_heat_below?: number;
  filter_heat_above?: number;
  max_fires?: number;
  cooldown_seconds?: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSulcusApi(filters?: MemoryFilters, activityFilters?: ActivityFilters, opts?: { enableTriggers?: boolean }) {
  const qc = useQueryClient();

  // ---- Graph (nodes + edges) — limited to prevent browser overload ----
  // NOTE: Server endpoint /api/v1/admin/visualize/graph does NOT support offset/pagination.
  // Once the server adds offset support, switch to chunked parallel fetching here
  // (e.g. 4 concurrent pages of 500, merged progressively).
  // For now, cap at 2000 to keep single-fetch payload manageable while
  // relying on client-side LOD filtering for visual performance.
  const graphLimit = filters?.graph_limit ?? 200;
  const graphNs = filters?.graph_namespace;
  const graphQs = new URLSearchParams();
  graphQs.set("limit", String(Math.min(graphLimit, 5000)));
  graphQs.set("compact", "true"); // labels not needed for canvas rendering
  if (graphNs) graphQs.set("namespace", graphNs);

  const graph = useQuery<GraphSnapshot>({
    queryKey: ["sulcus", "graph", graphLimit, graphNs ?? "all"],
    queryFn: () => apiFetch(`/api/v1/admin/visualize/graph?${graphQs}`),
    staleTime: 30_000,
  });

  // ---- Paginated node list (for table views) ----
  const memoryParams = new URLSearchParams();
  if (filters?.page) memoryParams.set("page", String(filters.page));
  if (filters?.page_size) memoryParams.set("page_size", String(filters.page_size));
  if (filters?.memory_type) memoryParams.set("memory_type", filters.memory_type);
  if (filters?.namespace) memoryParams.set("namespace", filters.namespace);
  if (filters?.pinned) memoryParams.set("pinned", filters.pinned);
  if (filters?.search) memoryParams.set("search", filters.search);
  if (filters?.sort) memoryParams.set("sort", filters.sort);
  if (filters?.order) memoryParams.set("order", filters.order);
  const memoryQs = memoryParams.toString();

  const memories = useQuery<PaginatedMemories>({
    queryKey: ["sulcus", "memories", memoryQs],
    queryFn: () => apiFetch(`/api/v1/agent/nodes${memoryQs ? `?${memoryQs}` : ""}`),
    staleTime: 30_000,
  });

  // ---- Usage / billing ----
  const usage = useQuery<UsageData[]>({
    queryKey: ["sulcus", "usage"],
    queryFn: () => apiFetch("/api/v1/admin/usage"),
    staleTime: 60_000,
  });

  // ---- Activity log ----
  const activityParams = new URLSearchParams();
  if (activityFilters?.limit) activityParams.set("limit", String(activityFilters.limit));
  if (activityFilters?.actor) activityParams.set("actor", activityFilters.actor);
  if (activityFilters?.action) activityParams.set("action", activityFilters.action);
  if (activityFilters?.before) activityParams.set("before", activityFilters.before);
  const activityQs = activityParams.toString();

  const activity = useQuery<{ items: ActivityItem[]; next_cursor: string | null }>({
    queryKey: ["sulcus", "activity", activityQs],
    queryFn: () => apiFetch(`/api/v1/activity${activityQs ? `?${activityQs}` : ""}`),
    staleTime: 30_000,
  });

  // ---- Gamification ----
  const gamification = useQuery<GamificationProfile>({
    queryKey: ["sulcus", "gamification"],
    queryFn: () => apiFetch("/api/v1/gamification/profile"),
    staleTime: 60_000,
  });

  // ---- API Keys ----
  const apiKeys = useQuery<ApiKey[]>({
    queryKey: ["sulcus", "apiKeys"],
    queryFn: () => apiFetch("/api/v1/keys"),
    staleTime: 60_000,
  });

  // ---- Thermo Config ----
  const thermoConfig = useQuery<ThermoResponse>({
    queryKey: ["sulcus", "thermo"],
    queryFn: () => apiFetch("/api/v1/settings/thermo"),
    staleTime: 60_000,
  });

  // ---- Recall Analytics ----
  const recallAnalytics = useQuery<RecallAnalytics>({
    queryKey: ["sulcus", "recallAnalytics"],
    queryFn: () => apiFetch("/api/v1/analytics/recall"),
    staleTime: 60_000,
  });

  // ---- Triggers (opt-in — only fetched when enableTriggers=true) ----
  const triggers = useQuery<{ triggers: Trigger[]; count: number }>({
    queryKey: ["sulcus", "triggers"],
    queryFn: () => apiFetch("/api/v1/triggers"),
    staleTime: 30_000,
    enabled: opts?.enableTriggers === true,
  });

  const triggerHistory = useQuery<{ history: TriggerLogEntry[]; count: number }>({
    queryKey: ["sulcus", "triggerHistory"],
    queryFn: () => apiFetch("/api/v1/triggers/history?limit=50"),
    staleTime: 30_000,
    enabled: opts?.enableTriggers === true,
  });

  // ---- Mutations ----
  const createKey = useMutation({
    mutationFn: (label: string) =>
      apiFetch<{ key: string; id: string }>("/api/v1/keys", {
        method: "POST",
        body: JSON.stringify({ label }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sulcus", "apiKeys"] });
    },
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/keys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sulcus", "apiKeys"] });
    },
  });

  const deleteNode = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/agent/nodes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sulcus"] });
    },
  });

  const patchNode = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      apiFetch(`/api/v1/agent/nodes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sulcus"] });
    },
  });

  const updateThermoConfig = useMutation({
    mutationFn: (patch: Partial<ThermoConfig>) =>
      apiFetch("/api/v1/settings/thermo", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sulcus", "thermo"] });
    },
  });

  const sendFeedback = useMutation({
    mutationFn: (body: { node_id: string; signal: "relevant" | "irrelevant" | "outdated" }) =>
      apiFetch("/api/v1/feedback", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sulcus"] });
    },
  });

  const createTrigger = useMutation({
    mutationFn: (input: CreateTriggerInput) =>
      apiFetch<{ ok: boolean; trigger_id: string }>("/api/v1/triggers", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sulcus", "triggers"] });
      qc.invalidateQueries({ queryKey: ["sulcus", "triggerHistory"] });
    },
  });

  const updateTrigger = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      apiFetch(`/api/v1/triggers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sulcus", "triggers"] });
    },
  });

  const deleteTrigger = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/triggers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sulcus", "triggers"] });
      qc.invalidateQueries({ queryKey: ["sulcus", "triggerHistory"] });
    },
  });

  const createNode = useMutation({
    mutationFn: (body: { label: string; memory_type?: string; heat?: number; namespace?: string }) =>
      apiFetch<{ id: string; label: string; memory_type: string; heat: number }>(`/api/v1/agent/nodes`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sulcus"] });
    },
  });

  // ---- Helpers ----
  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["sulcus"] });
  };

  return {
    graph,
    memories,
    usage,
    activity,
    gamification,
    apiKeys,
    thermoConfig,
    recallAnalytics,
    triggers,
    triggerHistory,
    deleteNode,
    patchNode,
    createNode,
    createKey,
    revokeKey,
    updateThermoConfig,
    sendFeedback,
    createTrigger,
    updateTrigger,
    deleteTrigger,
    refreshAll,
  };
}

// ---------------------------------------------------------------------------
// Focused hooks — use these to avoid triggering unrelated queries
// ---------------------------------------------------------------------------

/** API keys only — no graph, no memories, no activity queries. */
export function useApiKeys() {
  const qc = useQueryClient();

  const apiKeys = useQuery<ApiKey[]>({
    queryKey: ["sulcus", "apiKeys"],
    queryFn: () => apiFetch("/api/v1/keys"),
    staleTime: 60_000,
  });

  const createKey = useMutation({
    mutationFn: (label: string) =>
      apiFetch<{ key: string; id: string }>("/api/v1/keys", {
        method: "POST",
        body: JSON.stringify({ label }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sulcus", "apiKeys"] }); },
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/keys/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sulcus", "apiKeys"] }); },
  });

  return { apiKeys, createKey, revokeKey };
}

/** Thermo config only. */
export function useThermoConfig() {
  const qc = useQueryClient();

  const thermoConfig = useQuery<ThermoResponse>({
    queryKey: ["sulcus", "thermo"],
    queryFn: () => apiFetch("/api/v1/settings/thermo"),
    staleTime: 60_000,
  });

  const updateThermoConfig = useMutation({
    mutationFn: (patch: Partial<ThermoConfig>) =>
      apiFetch("/api/v1/settings/thermo", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sulcus", "thermo"] }); },
  });

  return { thermoConfig, updateThermoConfig };
}

/** Usage/billing data only. */
export function useUsage() {
  return useQuery<UsageData[]>({
    queryKey: ["sulcus", "usage"],
    queryFn: () => apiFetch("/api/v1/admin/usage"),
    staleTime: 60_000,
  });
}

/** Recall analytics only. */
export function useRecallAnalytics() {
  return useQuery<RecallAnalytics>({
    queryKey: ["sulcus", "recallAnalytics"],
    queryFn: () => apiFetch("/api/v1/analytics/recall"),
    staleTime: 60_000,
  });
}

/** Gamification profile only. */
export function useGamification() {
  return useQuery<GamificationProfile>({
    queryKey: ["sulcus", "gamification"],
    queryFn: () => apiFetch("/api/v1/gamification/profile"),
    staleTime: 60_000,
  });
}

/** Triggers only. */
export function useTriggers() {
  const qc = useQueryClient();

  const triggers = useQuery<{ triggers: Trigger[]; count: number }>({
    queryKey: ["sulcus", "triggers"],
    queryFn: () => apiFetch("/api/v1/triggers"),
    staleTime: 30_000,
  });

  const triggerHistory = useQuery<{ history: TriggerLogEntry[]; count: number }>({
    queryKey: ["sulcus", "triggerHistory"],
    queryFn: () => apiFetch("/api/v1/triggers/history?limit=50"),
    staleTime: 30_000,
  });

  const createTrigger = useMutation({
    mutationFn: (input: CreateTriggerInput) =>
      apiFetch<{ ok: boolean; trigger_id: string }>("/api/v1/triggers", {
        method: "POST", body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sulcus", "triggers"] });
      qc.invalidateQueries({ queryKey: ["sulcus", "triggerHistory"] });
    },
  });

  const updateTrigger = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      apiFetch(`/api/v1/triggers/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sulcus", "triggers"] }); },
  });

  const deleteTrigger = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/triggers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sulcus", "triggers"] });
      qc.invalidateQueries({ queryKey: ["sulcus", "triggerHistory"] });
    },
  });

  return { triggers, triggerHistory, createTrigger, updateTrigger, deleteTrigger };
}

/** Graph + paginated memories + mutations — for the memories page. No activity/usage/keys/thermo. */
export function useMemoriesPage(filters?: MemoryFilters) {
  const qc = useQueryClient();

  // NOTE: No server-side pagination for /api/v1/admin/visualize/graph yet.
  // Cap limit to 5000 max to avoid browser OOM. LOD handles visual perf.
  const graphLimit = filters?.graph_limit ?? 200;
  const graphNs = filters?.graph_namespace;
  const graphQs = new URLSearchParams();
  graphQs.set("limit", String(Math.min(graphLimit, 5000)));
  graphQs.set("compact", "true");
  if (graphNs) graphQs.set("namespace", graphNs);

  const graph = useQuery<GraphSnapshot>({
    queryKey: ["sulcus", "graph", graphLimit, graphNs ?? "all"],
    queryFn: () => apiFetch(`/api/v1/admin/visualize/graph?${graphQs}`),
    staleTime: 30_000,
  });

  const memoryParams = new URLSearchParams();
  if (filters?.page) memoryParams.set("page", String(filters.page));
  if (filters?.page_size) memoryParams.set("page_size", String(filters.page_size));
  if (filters?.memory_type) memoryParams.set("memory_type", filters.memory_type);
  if (filters?.namespace) memoryParams.set("namespace", filters.namespace);
  if (filters?.pinned) memoryParams.set("pinned", filters.pinned);
  if (filters?.search) memoryParams.set("search", filters.search);
  if (filters?.sort) memoryParams.set("sort", filters.sort);
  if (filters?.order) memoryParams.set("order", filters.order);
  const memoryQs = memoryParams.toString();

  const memories = useQuery<PaginatedMemories>({
    queryKey: ["sulcus", "memories", memoryQs],
    queryFn: () => apiFetch(`/api/v1/agent/nodes${memoryQs ? `?${memoryQs}` : ""}`),
    staleTime: 30_000,
  });

  const deleteNode = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/agent/nodes/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sulcus"] }); },
  });

  const patchNode = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      apiFetch(`/api/v1/agent/nodes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sulcus"] }); },
  });

  const createNode = useMutation({
    mutationFn: (body: { label: string; memory_type?: string; heat?: number; namespace?: string }) =>
      apiFetch<{ id: string; label: string; memory_type: string; heat: number }>(`/api/v1/agent/nodes`, {
        method: "POST", body: JSON.stringify(body),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sulcus"] }); },
  });

  const sendFeedback = useMutation({
    mutationFn: (body: { node_id: string; signal: "relevant" | "irrelevant" | "outdated" }) =>
      apiFetch("/api/v1/feedback", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sulcus"] }); },
  });

  const refreshAll = () => { qc.invalidateQueries({ queryKey: ["sulcus"] }); };

  return { graph, memories, deleteNode, patchNode, createNode, sendFeedback, refreshAll };
}
