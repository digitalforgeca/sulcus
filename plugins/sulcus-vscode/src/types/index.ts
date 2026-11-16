export type MemoryType = 'semantic' | 'fact' | 'preference' | 'episodic' | 'procedural' | 'synthesis';

export type DecayClass = 'fast' | 'normal' | 'slow' | 'glacial';

export interface MemoryNode {
  id: string;
  label: string;
  pointer_summary?: string;
  memory_type?: MemoryType;
  current_heat?: number;
  initial_heat?: number;
  min_heat?: number;
  is_pinned?: boolean;
  decay_class?: DecayClass;
  namespace?: string;
  created_at?: string;
  updated_at?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface SearchOptions {
  query: string;
  context?: string;
  limit?: number;
  namespace?: string;
  min_heat?: number;
  memory_type?: MemoryType;
}

export interface SearchResult {
  node?: MemoryNode;
  id?: string;
  label?: string;
  pointer_summary?: string;
  memory_type?: MemoryType;
  current_heat?: number;
  similarity?: number;
  score?: number;
  distance?: number;
}

export interface EntityRelation {
  entity_name: string;
  entity_type: string;
  related_memories?: Array<{
    id: string;
    memory_type: MemoryType;
    pointer_summary: string;
    label?: string;
  }>;
}

export interface EntityContextResponse {
  entities?: EntityRelation[];
}

export interface VcrClassifyResponse {
  quality: 'store' | 'discard' | string;
  should_store?: boolean;
  memory_type?: MemoryType;
  confidence?: number;
  utility_score?: number;
  reason?: string;
  reasoning?: string;
}

export type SIULabelResponse = VcrClassifyResponse;

export interface CreateMemoryParams {
  label: string;
  memory_type?: MemoryType;
  is_pinned?: boolean;
  decay_class?: DecayClass;
  initial_heat?: number;
  min_heat?: number;
  namespace?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface FeedbackParams {
  node_id: string;
  feedback_type: 'boost' | 'retract' | 'reinforce' | 'deprecate';
  strength?: number;
  reason?: string;
}

export interface DashboardStats {
  total_memories?: number;
  total_nodes?: number;
  active_memories?: number;
  pinned_count?: number;
  avg_heat?: number;
  type_distribution?: Array<{ memory_type: string; count: number }>;
  heat_distribution?: Record<string, number>;
  namespace_counts?: Array<{ namespace: string; count: number }>;
  namespace_count?: number;
  recent_nodes?: any[];
  storage_usage_bytes?: number;
  daemon_uptime_seconds?: number;
  daemon_version?: string;
}

export interface SulcusConfiguration {
  serverUrl: string;
  apiKey: string;
  namespace: string;
  binPath: string;
  autoStartDaemon: boolean;
  daemonPort: number;
  hybridMode: boolean;
  maxSummaryChars: number;
  autoRecallLimit: number;
  useVcrQualityGate: boolean;
}

export interface RecallResult {
  memories: SearchResult[];
  formattedBlock: string;
  graphContext?: string;
}
