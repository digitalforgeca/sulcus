"use client";

import { useCallback, useRef, useState, Fragment, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import {
  TbRefresh, TbTrash, TbX, TbFlame, TbTag, TbHash, TbTemperature,
  TbPin, TbPinnedOff, TbPencil, TbCheck, TbSearch, TbFilter, TbGauge,
  TbChevronLeft, TbChevronRight, TbChevronsLeft, TbChevronsRight,
  TbChevronDown, TbSnowflake,
  TbAtom, TbBook, TbHeart, TbBulb, TbClock, TbBolt,
  TbLayoutGrid, TbTable, TbColumns3,
} from "react-icons/tb";
import {
  GiAbstract074,
  GiAbstract076,
  GiAbstract098,
  GiAbstract060,
  GiAbstract008,
} from "react-icons/gi";
import { useMemoriesPage, type GraphNode, type MemoryNode } from "@/hooks/useSulcusApi";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import dynamic_import from "next/dynamic";

// WebGL graph renderer — loaded client-only (sigma.js needs DOM)
const WebGLGraph = dynamic_import(() => import("@/components/WebGLGraph"), { ssr: false });

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------
const TYPE_COLORS: Record<string, string> = {
  preference: "#D4AF37",
  semantic: "#00F0FF",
  procedural: "#8B5CF6",
  episodic: "#f59e0b",
  fact: "#22c55e",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  preference: <GiAbstract074 size={14} />,
  semantic: <GiAbstract076 size={14} />,
  procedural: <GiAbstract098 size={14} />,
  episodic: <GiAbstract060 size={14} />,
  fact: <GiAbstract008 size={14} />,
};


const TYPE_BADGE_CLASSES: Record<string, string> = {
  episodic: "border-amber-500/50 text-amber-400",
  semantic: "border-cyan-500/50 text-cyan-400",
  procedural: "border-purple-500/50 text-purple-400",
  preference: "border-yellow-600/50 text-yellow-500",
  fact: "border-green-500/50 text-green-400",
};

function nodeColor(type: string): string {
  return TYPE_COLORS[type] || "#444";
}

function TypeBadge({ type }: { type: string }) {
  const icon = TYPE_ICONS[type] || <TbTag size={12} />;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 border rounded-full uppercase tracking-widest ${TYPE_BADGE_CLASSES[type] || "border-[#333] text-[#666]"}`}>
      {icon}{type}
    </span>
  );
}

function heatLabel(v: number): string {
  if (v >= 0.8) return "blazing";
  if (v >= 0.6) return "hot";
  if (v >= 0.4) return "warm";
  if (v >= 0.2) return "cool";
  return "frozen";
}

function heatColor(v: number): string {
  if (v >= 0.8) return "#D4AF37";
  if (v >= 0.6) return "#f59e0b";
  if (v >= 0.4) return "#00F0FF";
  if (v >= 0.2) return "#3b82f6";
  return "#555";
}

// ---------------------------------------------------------------------------
// Rendered Markdown
// ---------------------------------------------------------------------------
function RenderedMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => <h1 className="text-sm font-bold text-[#D4AF37] mb-1 mt-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-xs font-bold text-[#D4AF37] mb-1 mt-2">{children}</h2>,
        h3: ({ children }) => <h3 className="text-xs font-semibold text-[#D4AF37]/80 mb-0.5 mt-1.5">{children}</h3>,
        p: ({ children }) => <p className="text-xs text-[#ccc] leading-relaxed mb-1.5">{children}</p>,
        strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
        em: ({ children }) => <em className="text-[#aaa] italic">{children}</em>,
        code: ({ className, children }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return <code className="block bg-black/40 border border-[#D4AF37]/10 rounded-sm p-2 text-[10px] font-mono text-[#00F0FF] overflow-x-auto my-1.5 whitespace-pre">{children}</code>;
          }
          return <code className="bg-[#D4AF37]/10 text-[#00F0FF] text-[10px] font-mono px-1 py-0.5 rounded-sm">{children}</code>;
        },
        pre: ({ children }) => <pre className="bg-black/40 border border-[#D4AF37]/10 rounded-sm p-2 text-[10px] font-mono text-[#00F0FF] overflow-x-auto my-1.5">{children}</pre>,
        ul: ({ children }) => <ul className="text-xs text-[#ccc] list-disc list-inside space-y-0.5 mb-1.5 ml-1">{children}</ul>,
        ol: ({ children }) => <ol className="text-xs text-[#ccc] list-decimal list-inside space-y-0.5 mb-1.5 ml-1">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        a: ({ href, children }) => <span className="text-[#00F0FF] underline">{children}</span>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-[#D4AF37]/40 pl-2 ml-1 my-1.5 text-[#888] italic text-xs">{children}</blockquote>,
        hr: () => <hr className="border-[#D4AF37]/20 my-2" />,
        table: ({ children }) => <table className="text-[10px] text-[#ccc] border-collapse w-full my-1.5">{children}</table>,
        th: ({ children }) => <th className="border border-[#333] px-1.5 py-0.5 text-left text-[#D4AF37] font-semibold bg-black/30">{children}</th>,
        td: ({ children }) => <td className="border border-[#333] px-1.5 py-0.5">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ---------------------------------------------------------------------------
// Heat Slider
// ---------------------------------------------------------------------------
function HeatSlider({ value, onChange, onCommit, disabled }: { value: number; onChange: (v: number) => void; onCommit?: (v: number) => void; disabled?: boolean }) {
  const color = heatColor(value);
  return (
    <div className="flex items-center gap-2 w-full">
      <TbSnowflake size={10} className="text-blue-500 shrink-0" />
      <input
        type="range"
        min={0} max={100} step={1}
        value={Math.round(value * 100)}
        onChange={e => onChange(Number(e.target.value) / 100)}
        onMouseUp={e => onCommit?.(Number((e.target as HTMLInputElement).value) / 100)}
        onTouchEnd={e => onCommit?.(Number((e.target as HTMLInputElement).value) / 100)}
        disabled={disabled}
        className="heat-slider flex-1 h-1 appearance-none bg-black/50 rounded-full cursor-pointer disabled:opacity-30"
        style={{
          ["--slider-color" as string]: color,
          accentColor: color,
          background: `linear-gradient(to right, ${color} ${value * 100}%, #111 ${value * 100}%)`,
        }}
      />
      <TbFlame size={10} className="text-[#D4AF37] shrink-0" />
      <span className="text-xs font-mono w-12 text-right" style={{ color }}>{value.toFixed(2)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact heat slider with local state — key prop resets instead of useEffect
// ---------------------------------------------------------------------------
function CommitHeatSlider({ initialValue, onCommit }: { initialValue: number; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState(initialValue);
  return <HeatSlider value={local} onChange={setLocal} onCommit={onCommit} />;
}

// ---------------------------------------------------------------------------
// Compact heat bar (non-interactive)
// ---------------------------------------------------------------------------
function HeatBar({ value }: { value: number }) {
  const pct = Math.min(value * 100, 100);
  const color = heatColor(value);
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-black/50 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
      </div>
      <span className="text-[10px] font-mono" style={{ color }}>{value.toFixed(2)}</span>
    </div>
  );
}

const MEMORY_TYPES = ["episodic", "semantic", "procedural", "preference", "fact"];
const PAGE_SIZES = [10, 25, 50];

// ---------------------------------------------------------------------------
// Main Page — no useEffect, no usePolling
// ---------------------------------------------------------------------------
export default function MemoriesPage() {
  // --- Selection + detail editing ---
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [detailState, setDetailState] = useState<{
    editing: boolean;
    saving: boolean;
    heat: number;
    label: string;
    type: string;
    fullLabel: string | null;
    fullLoading: boolean;
  }>({ editing: false, saving: false, heat: 0, label: "", type: "", fullLabel: null, fullLoading: false });
  const patchDetail = useCallback((patch: Partial<typeof detailState>) => {
    setDetailState(prev => ({ ...prev, ...patch }));
  }, []);

  // When selected changes, load full label and reset detail state
  const prevSelectedIdRef = useRef<string | null>(null);
  const handleSelectNode = useCallback((node: GraphNode | null) => {
    setSelected(node);
    if (!node) {
      prevSelectedIdRef.current = null;
      setDetailState({ editing: false, saving: false, heat: 0, label: "", type: "", fullLabel: null, fullLoading: false });
      return;
    }
    if (node.id !== prevSelectedIdRef.current) {
      prevSelectedIdRef.current = node.id;
      setDetailState({ editing: false, saving: false, heat: node.heat, label: node.label, type: node.memory_type, fullLabel: null, fullLoading: true });
      // Fetch full label — fire-and-forget, updates via setState
      apiFetch<{ label: string }>(`/api/v1/agent/nodes/${node.id}`)
        .then(data => {
          // Only update if still selected
          setSelected(current => {
            if (current?.id === node.id) {
              setDetailState(prev => prev.fullLoading ? { ...prev, fullLabel: data.label, label: data.label, fullLoading: false } : prev);
            }
            return current;
          });
        })
        .catch(() => {
          setDetailState(prev => prev.fullLoading ? { ...prev, fullLabel: node.label, fullLoading: false } : prev);
        });
    }
  }, []);

  // Create memory modal
  const [showCreate, setShowCreate] = useState(false);
  const [createLabel, setCreateLabel] = useState("");
  const [createType, setCreateType] = useState("episodic");
  const [createHeat, setCreateHeat] = useState(0.8);

  // --- Table state ---
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [typeFilter, setTypeFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [pinnedFilter, setPinnedFilter] = useState("");
  const [sortField, setSortField] = useState("heat");
  const [sortOrder, setSortOrder] = useState("desc");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedLabels, setExpandedLabels] = useState<Record<string, string>>({});
  const [expandedLoading, setExpandedLoading] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editType, setEditType] = useState("");
  const [editHeat, setEditHeat] = useState(0);

  // View toggle
  const [view, setView] = useState<"both" | "graph" | "table">("both");
  // Load graph nodes — compact mode means minimal data per node (id, type, heat, namespace)
  // Capped at 2000 for single-fetch sanity; server doesn't support offset yet.
  // LOD filtering in WebGLGraph handles visual performance for large datasets.
  const graphLimit = 2000;

  // React Query — single source of truth for data fetching + polling
  // refetchInterval replaces usePolling entirely
  const { graph, memories, deleteNode, patchNode, createNode, refreshAll } = useMemoriesPage({
    page, page_size: pageSize,
    memory_type: typeFilter || undefined,
    search: searchText || undefined,
    pinned: pinnedFilter || undefined,
    sort: sortField, order: sortOrder,
    graph_limit: graphLimit,
  });

  const toast = useToast();

  // Derive graph data
  const rawGraph = graph.data ?? { nodes: [], links: [] };
  const graphNodes = rawGraph.nodes;

  const graphEdges = useMemo(() => {
    // If server provides edges, use them directly (already capped in WebGLGraph)
    if (rawGraph.links.length > 0) return rawGraph.links;

    // Fallback: generate visual edges client-side.
    // For large graphs (>1000 nodes), generate minimal edges only for hot nodes
    // to avoid O(n²) edge generation that kills performance.
    const MAX_FALLBACK = 2000;
    const isLarge = graphNodes.length > 1000;
    const edges: { source: string; target: string; weight: number }[] = [];

    if (isLarge) {
      // Large graph: only connect hot nodes (heat > 0.5) to their type-group neighbors
      const hotByType: Record<string, typeof graphNodes> = {};
      graphNodes.forEach(n => {
        if (n.heat > 0.5) (hotByType[n.memory_type] ??= []).push(n);
      });
      Object.values(hotByType).forEach(group => {
        for (let i = 0; i < group.length - 1 && edges.length < MAX_FALLBACK; i++) {
          edges.push({ source: group[i].id, target: group[i + 1].id, weight: 0.6 });
        }
      });
    } else {
      // Small graph: full type-chain + heat proximity edges
      const byType: Record<string, typeof graphNodes> = {};
      graphNodes.forEach(n => { (byType[n.memory_type] ??= []).push(n); });
      Object.values(byType).forEach(group => {
        for (let i = 0; i < group.length - 1 && edges.length < MAX_FALLBACK; i++) {
          edges.push({ source: group[i].id, target: group[i + 1].id, weight: 0.6 });
        }
      });
      if (edges.length < MAX_FALLBACK) {
        const hotNodes = graphNodes.filter(n => n.heat > 0.6);
        for (let i = 0; i < hotNodes.length && i < 100 && edges.length < MAX_FALLBACK; i++) {
          for (let j = i + 1; j < hotNodes.length && j < 100 && edges.length < MAX_FALLBACK; j++) {
            if (hotNodes[i].memory_type !== hotNodes[j].memory_type && Math.abs(hotNodes[i].heat - hotNodes[j].heat) < 0.12) {
              edges.push({ source: hotNodes[i].id, target: hotNodes[j].id, weight: 0.25 });
            }
          }
        }
      }
    }
    return edges;
  }, [rawGraph.links, graphNodes]);

  // --- Actions ---
  const handleDelete = (id: string) => {
    if (!confirm("Permanently delete this memory node?")) return;
    deleteNode.mutate(id, { onSuccess: () => { setSelected(null); prevSelectedIdRef.current = null; } });
  };

  const handleDetailHeatSave = () => {
    if (!selected) return;
    patchDetail({ saving: true });
    patchNode.mutate({ id: selected.id, patch: { current_heat: detailState.heat } }, {
      onSuccess: () => {
        patchDetail({ saving: false });
        setSelected(prev => prev ? { ...prev, heat: detailState.heat } : null);
      },
      onError: () => patchDetail({ saving: false }),
    });
  };

  const togglePin = (node: MemoryNode) => {
    patchNode.mutate({ id: node.id, patch: { is_pinned: !node.is_pinned } });
  };

  const startEdit = (node: MemoryNode) => {
    setEditingId(node.id);
    setEditType(node.memory_type);
    setEditHeat(node.heat);
    if (expandedLabels[node.id]) {
      setEditLabel(expandedLabels[node.id]);
    } else {
      setEditLabel(node.label);
      apiFetch<{ label: string }>(`/api/v1/agent/nodes/${node.id}`)
        .then(data => { setEditLabel(data.label); setExpandedLabels(prev => ({ ...prev, [node.id]: data.label })); })
        .catch(() => {});
    }
  };
  const saveEdit = () => {
    if (!editingId) return;
    patchNode.mutate({ id: editingId, patch: { label: editLabel, memory_type: editType, current_heat: editHeat } }, { onSuccess: () => setEditingId(null) });
  };
  const cancelEdit = () => setEditingId(null);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else {
        next.add(id);
        if (!expandedLabels[id]) {
          setExpandedLoading(prev => { const s = new Set(prev); s.add(id); return s; });
          apiFetch<{ label: string }>(`/api/v1/agent/nodes/${id}`)
            .then(data => { setExpandedLabels(prev => ({ ...prev, [id]: data.label })); })
            .catch(() => {})
            .finally(() => { setExpandedLoading(prev => { const s = new Set(prev); s.delete(id); return s; }); });
        }
      }
      return next;
    });
  };

  const handleSearch = () => { setSearchText(searchInput); setPage(1); };

  const items = memories.data?.items ?? [];
  const total = memories.data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex flex-col gap-6 font-sans ">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
            <TbAtom size={20} className="text-[#00F0FF]" />
            Memory
          </h1>
          <p className="text-xs text-[#666] tracking-wider mt-1">
            {graphNodes.length} nodes · {graphEdges.length} edges · {total} indexed
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex border border-[#D4AF37]/20 text-[10px] uppercase tracking-widest">
            {([
              { key: "both" as const, icon: <TbColumns3 size={12} />, label: "Both" },
              { key: "graph" as const, icon: <TbLayoutGrid size={12} />, label: "Graph" },
              { key: "table" as const, icon: <TbTable size={12} />, label: "Table" },
            ]).map(v => (
              <button key={v.key} onClick={() => setView(v.key)}
                className={`px-3 py-1.5 transition-colors flex items-center gap-1.5 ${view === v.key ? "bg-[#D4AF37]/20 text-[#D4AF37]" : "text-[#555] hover:text-[#888]"}`}
                title={v.label}>
                {v.icon}
              </button>
            ))}
          </div>
          <button onClick={() => setShowCreate(true)}
            className="text-xs text-[#D4AF37] border border-[#D4AF37]/30 px-3 py-1.5 hover:bg-[#D4AF37]/10 transition-colors uppercase tracking-widest flex items-center gap-2">
            <TbBolt size={12} /> + Memory
          </button>
          <button
            onClick={() => refreshAll()}
            disabled={graph.isRefetching || memories.isRefetching}
            className="text-xs text-[#00F0FF] border border-[#00F0FF]/30 px-3 py-1.5 hover:bg-[#00F0FF]/10 transition-colors uppercase tracking-widest flex items-center gap-2 disabled:opacity-40"
          >
            <TbRefresh size={12} className={(graph.isRefetching || memories.isRefetching) ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Graph Section */}
      {(view === "graph" || view === "both") && (
        <div className="relative">
          <WebGLGraph
            graphNodes={graphNodes}
            graphEdges={graphEdges}
            view={view}
            onSelectNode={handleSelectNode}
          />

          {/* Detail panel — overlays on the right, doesn't shrink the graph */}
          {selected && (
            <div
              tabIndex={-1}
              ref={el => el?.focus()}
              onKeyDown={e => { if (e.key === 'Escape') { handleSelectNode(null); } }}
              className="absolute top-3 right-3 w-80 max-h-[calc(100%-24px)] bg-[#0a1520]/95 backdrop-blur-sm border border-[#D4AF37]/30 p-5 flex flex-col gap-4 overflow-y-auto z-20 shadow-xl outline-none">
              <div className="flex justify-between items-start">
                <h2 className="text-xs font-bold text-[#D4AF37] tracking-widest uppercase flex items-center gap-2">
                  <TbBolt size={12} /> {detailState.editing ? "Edit Memory" : "Node Detail"}
                </h2>
                <div className="flex items-center gap-1">
                  {!detailState.editing && (
                    <button onClick={() => patchDetail({ editing: true, label: selected.label, type: selected.memory_type })}
                      className="text-[#555] hover:text-[#00F0FF] transition-colors" title="Edit"><TbPencil size={14} /></button>
                  )}
                  <button onClick={() => { handleSelectNode(null); }} className="text-[#555] hover:text-white transition-colors"><TbX size={14} /></button>
                </div>
              </div>

              <div>
                <span className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Type</span>
                {detailState.editing ? (
                  <select value={detailState.type} onChange={e => patchDetail({ type: e.target.value })}
                    className="w-full bg-[#111820] border border-[#D4AF37]/50 text-white text-xs px-2 py-1.5 focus:outline-none rounded-sm">
                    {MEMORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                ) : (
                  <TypeBadge type={selected.memory_type} />
                )}
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <TbTemperature size={12} className="text-[#D4AF37]" />
                  <span className="text-xs text-[#888] uppercase tracking-wider">Heat</span>
                  <span className="text-[10px] uppercase tracking-wider ml-auto" style={{ color: heatColor(detailState.heat) }}>
                    {heatLabel(detailState.heat)}
                  </span>
                </div>
                <HeatSlider value={detailState.heat} onChange={(v: number) => patchDetail({ heat: v })} />
              </div>

              <div className="flex items-center gap-2">
                <TbGauge size={12} className="text-[#00F0FF]" />
                <span className="text-xs text-[#888] uppercase tracking-wider">Utility</span>
                <span className="text-sm font-mono text-[#00F0FF] ml-auto">—</span>
              </div>

              <div className="flex items-center gap-2">
                <TbHash size={12} className="text-[#666]" />
                <span className="text-[10px] font-mono text-[#444] break-all select-all">{selected.id}</span>
              </div>

              <div className="flex-1">
                <p className="text-xs text-[#666] tracking-wider uppercase mb-1 flex items-center gap-1.5">
                  <TbBook size={10} /> Summary
                </p>
                {detailState.editing ? (
                  <textarea value={detailState.label} onChange={e => patchDetail({ label: e.target.value })}
                    rows={6} className="w-full text-xs text-white leading-relaxed bg-[#050a0f] border border-[#D4AF37]/50 p-3 rounded-sm focus:outline-none focus:border-[#D4AF37] resize-y"
                    placeholder="Describe this memory…" />
                ) : (
                  <div className="bg-[#050a0f] border border-[#333] p-3 max-h-48 overflow-y-auto rounded-sm">
                    {detailState.fullLoading ? (
                      <span className="text-xs text-[#555] animate-pulse">Loading…</span>
                    ) : (detailState.fullLabel || selected.label) ? (
                      <RenderedMarkdown content={detailState.fullLabel || selected.label} />
                    ) : (
                      <span className="text-xs text-[#555]">(empty)</span>
                    )}
                  </div>
                )}
              </div>

              {/* Connected Nodes — traverse the graph */}
              {!detailState.editing && (() => {
                const neighbors = graphEdges
                  .filter(e => e.source === selected.id || e.target === selected.id)
                  .map(e => e.source === selected.id ? e.target : e.source)
                  .slice(0, 8);
                const neighborNodes = neighbors
                  .map(id => graphNodes.find(n => n.id === id))
                  .filter(Boolean) as typeof graphNodes;
                if (neighborNodes.length === 0) return null;
                return (
                  <div>
                    <p className="text-[10px] text-[#555] tracking-wider uppercase mb-2 flex items-center gap-1.5">
                      <TbAtom size={10} /> Connected ({neighborNodes.length})
                    </p>
                    <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                      {neighborNodes.map(n => (
                        <button key={n.id} onClick={() => handleSelectNode(n)}
                          className="flex items-center gap-2 text-left px-2 py-1.5 bg-[#050a0f] border border-[#222] hover:border-[#D4AF37]/40 transition-colors group">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: TYPE_COLORS[n.memory_type] || '#555' }} />
                          <span className="text-[10px] text-[#888] group-hover:text-white truncate flex-1">
                            {n.label?.slice(0, 50) || n.id.slice(0, 12)}
                          </span>
                          <span className="text-[9px] text-[#444] font-mono shrink-0">
                            {(n.heat ?? 0).toFixed(1)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="border-t border-[#D4AF37]/20 pt-3 flex flex-col gap-2">
                {detailState.editing ? (
                  <div className="flex gap-2">
                    <button onClick={() => {
                      const patch: Record<string, any> = {};
                      if (detailState.label !== selected.label) patch.label = detailState.label;
                      if (detailState.type !== selected.memory_type) patch.memory_type = detailState.type;
                      if (detailState.heat !== selected.heat) patch.current_heat = detailState.heat;
                      if (Object.keys(patch).length > 0) {
                        patchDetail({ saving: true });
                        patchNode.mutate({ id: selected.id, patch }, {
                          onSuccess: () => {
                            patchDetail({ saving: false, editing: false });
                            setSelected(prev => prev ? {
                              ...prev,
                              heat: patch.current_heat ?? prev.heat,
                              label: patch.label ?? prev.label,
                              memory_type: patch.memory_type ?? prev.memory_type,
                            } : null);
                          },
                          onError: () => patchDetail({ saving: false }),
                        });
                      } else {
                        patchDetail({ editing: false });
                      }
                    }} disabled={detailState.saving}
                      className="flex-1 text-xs text-[#050a0f] bg-[#D4AF37] px-3 py-2 hover:brightness-110 transition-all uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 rounded-sm font-bold">
                      <TbCheck size={12} /> {detailState.saving ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => patchDetail({ editing: false, heat: selected.heat })}
                      className="flex-1 text-xs text-[#888] border border-[#555]/30 px-3 py-2 hover:bg-[#555]/10 transition-colors uppercase tracking-widest flex items-center justify-center gap-2 rounded-sm">
                      <TbX size={12} /> Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {detailState.heat !== selected.heat && (
                      <button onClick={handleDetailHeatSave} disabled={detailState.saving}
                        className="flex-1 text-xs text-[#D4AF37] border border-[#D4AF37]/30 px-3 py-2 hover:bg-[#D4AF37]/10 transition-colors uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 rounded-sm">
                        {detailState.saving ? "Saving…" : "Apply Heat"}
                      </button>
                    )}
                    <button onClick={() => handleDelete(selected.id)} disabled={deleteNode.isPending}
                      className="flex-1 text-xs text-red-500 border border-red-500/30 px-3 py-2 hover:bg-red-500/10 transition-colors uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 rounded-sm">
                      <TbTrash size={12} /> Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Table Section */}
      {(view === "table" || view === "both") && (
        <>
          {/* Filter Bar */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center">
              <div className="relative">
                <TbSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
                <input value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()}
                  placeholder="Search memories…" className="bg-[#0a1520] border border-[#D4AF37]/20 text-white text-sm pl-9 pr-3 py-2 w-56 focus:outline-none focus:border-[#D4AF37]/50 placeholder-[#333] rounded-sm" />
              </div>
              <button onClick={handleSearch} className="bg-[#0a1520] border border-[#D4AF37]/20 border-l-0 px-3 py-2 text-[#555] hover:text-[#D4AF37] rounded-r-sm"><TbFilter size={14} /></button>
            </div>
            <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
              className="bg-[#0a1520] border border-[#D4AF37]/20 text-sm text-[#888] px-3 py-2 focus:outline-none appearance-none cursor-pointer rounded-sm">
              <option value="">All types</option>
              {MEMORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={pinnedFilter} onChange={e => { setPinnedFilter(e.target.value); setPage(1); }}
              className="bg-[#0a1520] border border-[#D4AF37]/20 text-sm text-[#888] px-3 py-2 focus:outline-none appearance-none cursor-pointer rounded-sm">
              <option value="">All</option><option value="true">📌 Pinned</option><option value="false">Unpinned</option>
            </select>
            <select value={`${sortField}:${sortOrder}`} onChange={e => { const [f, o] = e.target.value.split(":"); setSortField(f); setSortOrder(o); setPage(1); }}
              className="bg-[#0a1520] border border-[#D4AF37]/20 text-sm text-[#888] px-3 py-2 focus:outline-none appearance-none cursor-pointer rounded-sm">
              <option value="heat:desc">🔥 Hottest</option><option value="heat:asc">❄️ Coldest</option><option value="updated_at:desc">🕐 Recent</option><option value="label:asc">A→Z</option>
            </select>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="bg-[#0a1520] border border-[#D4AF37]/20 text-sm text-[#888] px-3 py-2 focus:outline-none appearance-none cursor-pointer rounded-sm">
              {PAGE_SIZES.map(s => <option key={s} value={s}>{s}/pg</option>)}
            </select>
            {(typeFilter || searchText || pinnedFilter) && (
              <button onClick={() => { setTypeFilter(""); setSearchText(""); setSearchInput(""); setPinnedFilter(""); setPage(1); }}
                className="text-xs text-red-400/70 hover:text-red-400 px-3 py-2 uppercase tracking-widest flex items-center gap-1">
                <TbX size={12} /> Clear
              </button>
            )}
          </div>

          {/* Table */}
          <div className="bg-[#0a1520] border border-[#D4AF37]/30 shadow-[0_0_20px_rgba(0,0,0,0.5)] relative overflow-x-auto rounded-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#111820] text-[#D4AF37] text-xs uppercase tracking-widest border-b border-[#D4AF37]/30">
                <tr>
                  <th className="p-3 w-8"></th>
                  <th className="p-3 w-10"><TbPin size={12} className="text-[#555]" /></th>
                  <th className="p-3">Summary</th>
                  <th className="p-3 w-28">Type</th>
                  <th className="p-3 w-40"><span className="flex items-center gap-1"><TbTemperature size={12} /> Heat</span></th>
                  <th className="p-3 w-20"><TbClock size={12} className="inline mr-1" />Age</th>
                  <th className="p-3 w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D4AF37]/10">
                {memories.isLoading ? (
                  <tr><td colSpan={7} className="p-12 text-center text-[#888] animate-pulse uppercase tracking-widest">Loading…</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={7} className="p-12 text-center text-[#555] uppercase tracking-widest">No memories match.</td></tr>
                ) : items.map(node => {
                  const isExpanded = expandedIds.has(node.id);
                  const isEditing = editingId === node.id;
                  const d = new Date(node.updated_at);
                  const diffH = Math.floor((Date.now() - d.getTime()) / 3600000);
                  const relative = diffH < 1 ? "now" : diffH < 24 ? `${diffH}h` : `${Math.floor(diffH / 24)}d`;

                  return (
                    <Fragment key={node.id}>
                      <tr className="hover:bg-[#D4AF37]/5 transition-colors group cursor-pointer"
                        onClick={(e) => {
                          const tag = (e.target as HTMLElement).tagName;
                          if (tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || (e.target as HTMLElement).closest("button")) return;
                          toggleExpand(node.id);
                        }}>
                        <td className="p-3"><span className="text-[#555] group-hover:text-[#D4AF37] transition-colors">
                          {isExpanded ? <TbChevronDown size={14} /> : <TbChevronRight size={14} />}
                        </span></td>
                        <td className="p-3"><button onClick={(e) => { e.stopPropagation(); togglePin(node); }}
                          className={`transition-colors ${node.is_pinned ? "text-[#D4AF37]" : "text-[#333] hover:text-[#555]"}`}>
                          {node.is_pinned ? <TbPin size={14} /> : <TbPinnedOff size={14} />}
                        </button></td>
                        <td className="p-3">{isEditing ? (
                          <input value={editLabel} onChange={e => setEditLabel(e.target.value)} autoFocus
                            onClick={e => e.stopPropagation()}
                            className="w-full bg-[#111820] border border-[#D4AF37]/50 text-white px-2 py-1 text-sm focus:outline-none rounded-sm" />
                        ) : (
                          <span className="text-[#ccc] text-sm hover:text-white transition-colors" title={node.label}>
                            {node.label.length > 100 ? node.label.slice(0, 100) + "…" : node.label}
                          </span>
                        )}</td>
                        <td className="p-3">{isEditing ? (
                          <select value={editType} onChange={e => setEditType(e.target.value)}
                            onClick={e => e.stopPropagation()}
                            className="bg-[#111820] border border-[#D4AF37]/50 text-white text-xs px-1 py-0.5 rounded-sm">
                            {MEMORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        ) : <TypeBadge type={node.memory_type} />}</td>
                        <td className="p-3" onClick={e => isEditing && e.stopPropagation()}>{isEditing ? (
                          <HeatSlider value={editHeat} onChange={setEditHeat} />
                        ) : (
                          <HeatBar value={node.heat} />
                        )}</td>
                        <td className="p-3"><span className="text-xs text-[#555] flex items-center gap-1" title={d.toISOString()}>
                          <TbClock size={10} />{relative}
                        </span></td>
                        <td className="p-3">{isEditing ? (
                          <div className="flex gap-1">
                            <button onClick={saveEdit} className="text-green-500 p-1 hover:bg-green-500/10 rounded-sm" title="Save"><TbCheck size={14} /></button>
                            <button onClick={cancelEdit} className="text-red-500 p-1 hover:bg-red-500/10 rounded-sm" title="Cancel"><TbX size={14} /></button>
                          </div>
                        ) : (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => startEdit(node)} className="text-[#555] hover:text-[#00F0FF] p-1 rounded-sm" title="Edit"><TbPencil size={14} /></button>
                            <button onClick={() => handleDelete(node.id)} className="text-[#555] hover:text-red-500 p-1 rounded-sm" title="Delete"><TbTrash size={14} /></button>
                          </div>
                        )}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-[#060d14]"><td colSpan={7} className="p-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs mb-3">
                            <div>
                              <span className="text-[#555] uppercase tracking-wider block mb-1 flex items-center gap-1"><TbGauge size={10} /> Utility</span>
                              <span className="text-white font-mono">{node.base_utility.toFixed(3)}</span>
                            </div>
                            <div>
                              <span className="text-[#555] uppercase tracking-wider block mb-1 flex items-center gap-1"><TbAtom size={10} /> Modality</span>
                              <span className="text-white">{node.modality}</span>
                            </div>
                            <div>
                              <span className="text-[#555] uppercase tracking-wider block mb-1 flex items-center gap-1"><TbTag size={10} /> Namespace</span>
                              <span className="text-white">{node.namespace}</span>
                            </div>
                            <div>
                              <span className="text-[#555] uppercase tracking-wider block mb-1 flex items-center gap-1"><TbHash size={10} /> ID</span>
                              <span className="text-[#555] font-mono text-[10px] break-all select-all">{node.id}</span>
                            </div>
                          </div>
                          <div className="mb-3">
                            <span className="text-[#555] uppercase tracking-wider text-xs flex items-center gap-1 mb-1"><TbTemperature size={10} /> Heat Control</span>
                            <div className="max-w-sm">
                              <CommitHeatSlider key={`${node.id}-${node.heat}`} initialValue={node.heat} onCommit={(v) => patchNode.mutate({ id: node.id, patch: { current_heat: v } })} />
                            </div>
                          </div>
                          <div className="max-h-48 overflow-y-auto bg-black/30 p-3 border border-[#D4AF37]/10 rounded-sm">
                            {expandedLoading.has(node.id) ? (
                              <span className="text-xs text-[#555] animate-pulse">Loading…</span>
                            ) : (
                              <RenderedMarkdown content={expandedLabels[node.id] || node.label} />
                            )}
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#555] font-mono">{((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={page === 1} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20"><TbChevronsLeft size={14} /></button>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20"><TbChevronLeft size={14} /></button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let p: number;
                  if (totalPages <= 5) p = i + 1;
                  else if (page <= 3) p = i + 1;
                  else if (page >= totalPages - 2) p = totalPages - 4 + i;
                  else p = page - 2 + i;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`w-8 h-8 text-xs font-mono rounded-sm ${p === page ? "bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/50" : "text-[#555] hover:text-white"}`}>
                      {p}
                    </button>
                  );
                })}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20"><TbChevronRight size={14} /></button>
                <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20"><TbChevronsRight size={14} /></button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create Memory Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="bg-[#0a1520] border border-[#D4AF37]/30 p-6 w-full max-w-md rounded-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-sm font-bold text-[#D4AF37] tracking-widest uppercase mb-4 flex items-center gap-2">
              <TbBolt size={14} /> Create Memory
            </h2>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Summary</label>
                <textarea value={createLabel} onChange={e => setCreateLabel(e.target.value)}
                  rows={4} placeholder="Describe this memory…"
                  className="w-full bg-[#050a0f] border border-[#333] text-white text-sm px-3 py-2 focus:outline-none focus:border-[#D4AF37] rounded-sm resize-y" />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Type</label>
                  <select value={createType} onChange={e => setCreateType(e.target.value)}
                    className="w-full bg-[#050a0f] border border-[#333] text-white text-xs px-2 py-1.5 rounded-sm">
                    {MEMORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Initial Heat</label>
                  <HeatSlider value={createHeat} onChange={setCreateHeat} />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    if (!createLabel.trim()) return;
                    createNode.mutate({ label: createLabel.trim(), memory_type: createType, heat: createHeat }, {
                      onSuccess: () => {
                        setShowCreate(false);
                        setCreateLabel("");
                        setCreateType("episodic");
                        setCreateHeat(0.8);
                        toast.success("Memory created");
                      },
                    });
                  }}
                  disabled={!createLabel.trim() || createNode.isPending}
                  className="flex-1 text-xs text-[#050a0f] bg-[#D4AF37] px-4 py-2 hover:brightness-110 transition-all uppercase tracking-widest font-bold disabled:opacity-50 rounded-sm flex items-center justify-center gap-2"
                >
                  <TbCheck size={12} /> {createNode.isPending ? "Creating…" : "Create"}
                </button>
                <button onClick={() => setShowCreate(false)}
                  className="flex-1 text-xs text-[#888] border border-[#555]/30 px-4 py-2 hover:bg-[#555]/10 transition-colors uppercase tracking-widest rounded-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
