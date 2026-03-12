import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SERVER_URL =
  process.env.NEXT_PUBLIC_SULCUS_SERVER_URL ||
  "https://sulcus-server.calmstone-a7a24a97.westus.azurecontainerapps.io";

const API_KEY = process.env.NEXT_PUBLIC_SULCUS_API_KEY || "";

function headers() {
  return { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: { ...headers(), ...init?.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryNode {
  id: string;
  label: string;
  memory_type: string;
  heat: number;
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSulcusApi() {
  const qc = useQueryClient();

  // ---- Graph (nodes + edges) ----
  const graph = useQuery<GraphSnapshot>({
    queryKey: ["sulcus", "graph"],
    queryFn: () => apiFetch("/api/v1/admin/visualize/graph"),
    staleTime: 30_000,
  });

  // ---- Flat node list (for table views) ----
  const memories = useQuery<MemoryNode[]>({
    queryKey: ["sulcus", "memories"],
    queryFn: () => apiFetch("/api/v1/agent/nodes"),
    staleTime: 30_000,
  });

  // ---- Usage / billing ----
  const usage = useQuery<UsageData>({
    queryKey: ["sulcus", "usage"],
    queryFn: () => apiFetch("/api/v1/admin/usage"),
    staleTime: 60_000,
  });

  // ---- Mutations ----
  const deleteNode = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/agent/nodes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sulcus", "graph"] });
      qc.invalidateQueries({ queryKey: ["sulcus", "memories"] });
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
    deleteNode,
    refreshAll,
  };
}
