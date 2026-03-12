"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import dynamic2 from "next/dynamic";
import {
  RefreshCw, Trash2, X, Flame, Tag, Hash,
  Pin, PinOff, Pencil, Check, Search, Filter,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ChevronDown as ChevDown, ChevronRight as ChevRight,
} from "lucide-react";
import { useSulcusApi, type GraphNode, type MemoryNode } from "@/hooks/useSulcusApi";

const ForceGraph2D = dynamic2(
  () => import("react-force-graph-2d").then((m) => m.default || m),
  { ssr: false }
);

// ---------------------------------------------------------------------------
// Shared colours
// ---------------------------------------------------------------------------
const TYPE_COLORS: Record<string, string> = {
  preference: "#D4AF37",
  semantic: "#00F0FF",
  procedural: "#8B5CF6",
  episodic: "#555",
  fact: "#22c55e",
  default: "#444",
};

const TYPE_BADGE_CLASSES: Record<string, string> = {
  episodic: "border-purple-500/50 text-purple-400",
  semantic: "border-blue-500/50 text-blue-400",
  procedural: "border-green-500/50 text-green-400",
  preference: "border-amber-500/50 text-amber-400",
  fact: "border-cyan-500/50 text-cyan-400",
};

function nodeColor(type: string): string {
  return TYPE_COLORS[type] || TYPE_COLORS.default;
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 border rounded-full uppercase tracking-widest ${TYPE_BADGE_CLASSES[type] || "border-[#333] text-[#666]"}`}>
      {type}
    </span>
  );
}

function HeatBar({ value }: { value: number }) {
  const pct = Math.min(value * 100, 100);
  const color = value > 0.7 ? "#D4AF37" : value > 0.3 ? "#00F0FF" : "#333";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-black/50 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
      </div>
      <span className="text-xs font-mono text-[#888]">{value.toFixed(2)}</span>
    </div>
  );
}

const MEMORY_TYPES = ["episodic", "semantic", "procedural", "preference", "fact"];
const PAGE_SIZES = [10, 25, 50];

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function MemoriesPage() {
  // --- Graph state ---
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editType, setEditType] = useState("");

  // View toggle
  const [view, setView] = useState<"graph" | "table" | "both">("both");

  const { graph, memories, deleteNode, patchNode, refreshAll } = useSulcusApi({
    page, page_size: pageSize,
    memory_type: typeFilter || undefined,
    search: searchText || undefined,
    pinned: pinnedFilter || undefined,
    sort: sortField, order: sortOrder,
  });

  // Responsive graph sizing
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: Math.max(400, Math.min(500, rect.height)) });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // --- Graph callbacks ---
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D) => {
    const isSelected = selected?.id === node.id;
    const r = 4 + (node.heat ?? 0.5) * 8;
    const color = nodeColor(node.memory_type);
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI);
      ctx.fillStyle = `${color}44`;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = isSelected ? "#fff" : `${color}88`;
    ctx.lineWidth = isSelected ? 1.5 : 0.5;
    ctx.stroke();
  }, [selected]);

  const handleNodeClick = useCallback((node: any) => {
    setSelected(node);
    if (graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 400);
      graphRef.current.zoom(3, 400);
    }
  }, []);

  // --- Table callbacks ---
  const handleDelete = (id: string) => {
    if (!confirm("Permanently delete this memory node?")) return;
    deleteNode.mutate(id, { onSuccess: () => setSelected(null) });
  };

  const togglePin = (node: MemoryNode) => {
    patchNode.mutate({ id: node.id, patch: { is_pinned: !node.is_pinned } });
  };

  const startEdit = (node: MemoryNode) => {
    setEditingId(node.id);
    setEditLabel(node.label);
    setEditType(node.memory_type);
  };
  const saveEdit = () => {
    if (!editingId) return;
    patchNode.mutate({ id: editingId, patch: { label: editLabel, memory_type: editType } }, { onSuccess: () => setEditingId(null) });
  };
  const cancelEdit = () => setEditingId(null);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSearch = () => { setSearchText(searchInput); setPage(1); };

  const items = memories.data?.items ?? [];
  const total = memories.data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);
  const graphData = graph.data ?? { nodes: [], links: [] };

  const typeCounts: Record<string, number> = {};
  graphData.nodes.forEach(n => { typeCounts[n.memory_type] = (typeCounts[n.memory_type] || 0) + 1; });

  return (
    <div className="flex flex-col gap-6 font-sans max-w-6xl">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
            <div className="w-2 h-2 bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]" />
            Memory
          </h1>
          <p className="text-xs text-[#666] tracking-wider mt-1">
            {graphData.nodes.length} nodes · {graphData.links.length} edges · {total} in index
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex border border-[#D4AF37]/20 text-[10px] uppercase tracking-widest">
            {(["both", "graph", "table"] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 transition-colors ${view === v ? "bg-[#D4AF37]/20 text-[#D4AF37]" : "text-[#555] hover:text-[#888]"}`}>
                {v}
              </button>
            ))}
          </div>
          <button onClick={() => refreshAll()} disabled={graph.isRefetching}
            className="text-xs text-[#00F0FF] border border-[#00F0FF]/30 px-3 py-1.5 hover:bg-[#00F0FF]/10 transition-colors uppercase tracking-widest flex items-center gap-2 disabled:opacity-50">
            <RefreshCw size={12} className={graph.isRefetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Graph Section */}
      {(view === "graph" || view === "both") && (
        <div className="flex gap-4 min-h-[400px]">
          <div ref={containerRef} className="flex-1 bg-[#050a0f] border border-[#D4AF37]/20 relative overflow-hidden">
            {/* Legend */}
            <div className="absolute top-3 left-3 z-10 flex gap-3 text-[10px] tracking-widest uppercase">
              {Object.entries(typeCounts).map(([type, count]) => (
                <span key={type} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: nodeColor(type) }} />
                  <span className="text-[#888]">{type} ({count})</span>
                </span>
              ))}
            </div>
            {graph.isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center text-[#555] animate-pulse tracking-widest text-sm uppercase">Loading graph…</div>
            ) : (
              <ForceGraph2D
                ref={graphRef}
                graphData={graphData}
                width={dimensions.width}
                height={dimensions.height}
                nodeCanvasObject={paintNode}
                nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                  const r = 4 + (node.heat ?? 0.5) * 8;
                  ctx.beginPath(); ctx.arc(node.x, node.y, r + 2, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill();
                }}
                onNodeClick={handleNodeClick}
                linkColor={() => "#D4AF3744"}
                linkWidth={(link: any) => Math.max(0.5, (link.weight || 0.5) * 2)}
                backgroundColor="#050a0f"
                cooldownTicks={80}
                d3AlphaDecay={0.02}
                d3VelocityDecay={0.3}
                nodeLabel={(node: any) => node.label?.length > 60 ? node.label.slice(0, 60) + "…" : node.label}
              />
            )}
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="w-72 bg-[#0a1520] border border-[#D4AF37]/30 p-4 flex flex-col gap-3 overflow-y-auto shrink-0">
              <div className="flex justify-between items-start">
                <h2 className="text-xs font-bold text-[#D4AF37] tracking-widest uppercase">Node Detail</h2>
                <button onClick={() => setSelected(null)} className="text-[#555] hover:text-white"><X size={14} /></button>
              </div>
              <div className="flex items-center gap-2"><Tag size={12} className="text-[#666]" /><TypeBadge type={selected.memory_type} /></div>
              <div className="flex items-center gap-2"><Flame size={12} className="text-[#D4AF37]" /><span className="text-xs text-[#888]">Heat</span><span className="text-sm font-mono text-[#D4AF37] ml-auto">{selected.heat.toFixed(3)}</span></div>
              <div className="flex items-center gap-2"><Hash size={12} className="text-[#666]" /><span className="text-[10px] font-mono text-[#555] break-all">{selected.id}</span></div>
              <div className="flex-1">
                <p className="text-xs text-[#666] tracking-wider uppercase mb-1">Summary</p>
                <div className="text-xs text-[#ccc] leading-relaxed bg-[#050a0f] border border-[#333] p-3 max-h-48 overflow-y-auto font-mono">{selected.label || "(empty)"}</div>
              </div>
              <div className="border-t border-[#D4AF37]/20 pt-2 flex gap-2">
                <button onClick={() => handleDelete(selected.id)} disabled={deleteNode.isPending}
                  className="flex-1 text-xs text-red-500 border border-red-500/30 px-3 py-1.5 hover:bg-red-500/10 transition-colors uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50">
                  <Trash2 size={12} />Delete
                </button>
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
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
                <input value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()}
                  placeholder="Search…" className="bg-[#0a1520] border border-[#D4AF37]/20 text-white text-sm pl-9 pr-3 py-2 w-56 focus:outline-none focus:border-[#D4AF37]/50 placeholder-[#333]" />
              </div>
              <button onClick={handleSearch} className="bg-[#0a1520] border border-[#D4AF37]/20 border-l-0 px-3 py-2 text-[#555] hover:text-[#D4AF37]"><Filter size={14} /></button>
            </div>
            <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
              className="bg-[#0a1520] border border-[#D4AF37]/20 text-sm text-[#888] px-3 py-2 focus:outline-none appearance-none cursor-pointer">
              <option value="">All types</option>
              {MEMORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={pinnedFilter} onChange={e => { setPinnedFilter(e.target.value); setPage(1); }}
              className="bg-[#0a1520] border border-[#D4AF37]/20 text-sm text-[#888] px-3 py-2 focus:outline-none appearance-none cursor-pointer">
              <option value="">All</option><option value="true">Pinned</option><option value="false">Unpinned</option>
            </select>
            <select value={`${sortField}:${sortOrder}`} onChange={e => { const [f, o] = e.target.value.split(":"); setSortField(f); setSortOrder(o); setPage(1); }}
              className="bg-[#0a1520] border border-[#D4AF37]/20 text-sm text-[#888] px-3 py-2 focus:outline-none appearance-none cursor-pointer">
              <option value="heat:desc">Hottest</option><option value="heat:asc">Coldest</option><option value="updated_at:desc">Recent</option><option value="label:asc">A→Z</option>
            </select>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="bg-[#0a1520] border border-[#D4AF37]/20 text-sm text-[#888] px-3 py-2 focus:outline-none appearance-none cursor-pointer">
              {PAGE_SIZES.map(s => <option key={s} value={s}>{s}/pg</option>)}
            </select>
            {(typeFilter || searchText || pinnedFilter) && (
              <button onClick={() => { setTypeFilter(""); setSearchText(""); setSearchInput(""); setPinnedFilter(""); setPage(1); }}
                className="text-xs text-red-400/70 hover:text-red-400 px-3 py-2 uppercase tracking-widest">Clear</button>
            )}
          </div>

          {/* Table */}
          <div className="bg-[#0a1520] border border-[#D4AF37]/30 shadow-[0_0_20px_rgba(0,0,0,0.5)] relative overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#111820] text-[#D4AF37] text-xs uppercase tracking-widest border-b border-[#D4AF37]/30">
                <tr>
                  <th className="p-3 w-8"></th>
                  <th className="p-3 w-10"><Pin size={12} className="text-[#555]" /></th>
                  <th className="p-3">Summary</th>
                  <th className="p-3 w-24">Type</th>
                  <th className="p-3 w-32">Heat</th>
                  <th className="p-3 w-20">Updated</th>
                  <th className="p-3 w-16"></th>
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
                  const relative = diffH < 1 ? "now" : diffH < 24 ? `${diffH}h` : `${Math.floor(diffH/24)}d`;

                  return (
                    <Fragment key={node.id}>
                      <tr className="hover:bg-[#D4AF37]/5 transition-colors group">
                        <td className="p-3"><button onClick={() => toggleExpand(node.id)} className="text-[#555] hover:text-[#D4AF37]">
                          {isExpanded ? <ChevDown size={14}/> : <ChevRight size={14}/>}
                        </button></td>
                        <td className="p-3"><button onClick={() => togglePin(node)} className={node.is_pinned ? "text-[#D4AF37]" : "text-[#333] hover:text-[#555]"}>
                          {node.is_pinned ? <Pin size={14}/> : <PinOff size={14}/>}
                        </button></td>
                        <td className="p-3">{isEditing ? (
                          <input value={editLabel} onChange={e => setEditLabel(e.target.value)} autoFocus
                            className="w-full bg-[#111820] border border-[#D4AF37]/50 text-white px-2 py-1 text-sm font-mono focus:outline-none" />
                        ) : (
                          <span className="text-[#ccc] text-sm" title={node.label}>{node.label.length > 100 ? node.label.slice(0,100)+"…" : node.label}</span>
                        )}</td>
                        <td className="p-3">{isEditing ? (
                          <select value={editType} onChange={e => setEditType(e.target.value)}
                            className="bg-[#111820] border border-[#D4AF37]/50 text-white text-xs px-1 py-0.5">
                            {MEMORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        ) : <TypeBadge type={node.memory_type} />}</td>
                        <td className="p-3"><HeatBar value={node.heat} /></td>
                        <td className="p-3"><span className="text-xs text-[#555]" title={d.toISOString()}>{relative}</span></td>
                        <td className="p-3">{isEditing ? (
                          <div className="flex gap-1">
                            <button onClick={saveEdit} className="text-green-500 p-1"><Check size={14}/></button>
                            <button onClick={cancelEdit} className="text-red-500 p-1"><X size={14}/></button>
                          </div>
                        ) : (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => startEdit(node)} className="text-[#555] hover:text-[#00F0FF] p-1"><Pencil size={14}/></button>
                            <button onClick={() => handleDelete(node.id)} className="text-[#555] hover:text-red-500 p-1"><Trash2 size={14}/></button>
                          </div>
                        )}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-[#060d14]"><td colSpan={7} className="p-4">
                          <div className="grid grid-cols-4 gap-4 text-xs mb-3">
                            <div><span className="text-[#555] uppercase tracking-wider block mb-1">Utility</span><span className="text-white font-mono">{node.base_utility.toFixed(3)}</span></div>
                            <div><span className="text-[#555] uppercase tracking-wider block mb-1">Modality</span><span className="text-white">{node.modality}</span></div>
                            <div><span className="text-[#555] uppercase tracking-wider block mb-1">Namespace</span><span className="text-white">{node.namespace}</span></div>
                            <div><span className="text-[#555] uppercase tracking-wider block mb-1">ID</span><span className="text-[#555] font-mono text-[10px] break-all">{node.id}</span></div>
                          </div>
                          <pre className="text-[#999] text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto bg-black/30 p-3 border border-[#D4AF37]/10 rounded">{node.label}</pre>
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
              <span className="text-xs text-[#555] font-mono">{((page-1)*pageSize)+1}–{Math.min(page*pageSize, total)} of {total}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={page===1} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20"><ChevronsLeft size={14}/></button>
                <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20"><ChevronLeft size={14}/></button>
                {Array.from({length:Math.min(5,totalPages)},(_,i) => {
                  let p: number;
                  if(totalPages<=5) p=i+1; else if(page<=3) p=i+1; else if(page>=totalPages-2) p=totalPages-4+i; else p=page-2+i;
                  return <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 text-xs font-mono ${p===page?"bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/50":"text-[#555] hover:text-white"}`}>{p}</button>;
                })}
                <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20"><ChevronRight size={14}/></button>
                <button onClick={() => setPage(totalPages)} disabled={page===totalPages} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20"><ChevronsRight size={14}/></button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
