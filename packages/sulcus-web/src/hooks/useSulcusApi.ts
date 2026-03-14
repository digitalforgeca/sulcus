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
  org_name: string;
  plan_tier: string;
  created_at: string;
  key_hash: string;
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
}

export interface GraphNode {
  id: string;
  label: string;
  memory_type: string;
  heat: number;
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
}

export interface UsageData {
  billing_period_start: string;
  billing_period_end: string;
  sync_requests: number;
  nodes_added: number;
  storage_bytes?: number;
}

// ---- Thermodynamics ----

export interface DecayProfile {
  half_life_secs: number;
  floor: number;
  stability_gain: number;
  reinforce_on_recall: number;
}

export interface ThermoConfig {
  decay_profiles: Record<string, DecayProfile>;
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSulcusApi(filters?: MemoryFilters, activityFilters?: ActivityFilters) {
  const qc = useQueryClient();

  // ---- Graph (nodes + edges) ----
  const graph = useQuery<GraphSnapshot>({
    queryKey: ["sulcus", "graph"],
    queryFn: () => apiFetch("/api/v1/admin/visualize/graph"),
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
  const usage = useQuery<UsageData>({
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
    deleteNode,
    patchNode,
    createNode,
    createKey,
    revokeKey,
    updateThermoConfig,
    sendFeedback,
    refreshAll,
  };
}
