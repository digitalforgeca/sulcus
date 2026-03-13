"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState, Fragment } from "react";
// No dynamic import — using custom static canvas graph (no d3/force simulation)
import {
  RefreshCw, Trash2, X, Flame, Tag, Hash, Thermometer,
  Pin, PinOff, Pencil, Check, Search, Filter, Gauge,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ChevronDown, ChevronRight as ChevRight, Snowflake,
  Brain, BookOpen, Heart, Lightbulb, Clock, Zap,
  LayoutGrid, Table2, Columns3,
} from "lucide-react";
import {
  GiAbstract074, // preference — orbital/molecular
  GiAbstract076, // semantic — branching network
  GiAbstract098, // procedural — grid/hash structure
  GiAbstract060, // episodic — compass/portal
  GiAbstract008, // fact — starburst
} from "react-icons/gi";
import { useSulcusApi, type GraphNode, type MemoryNode } from "@/hooks/useSulcusApi";

// Static graph — no force simulation, no animation, deterministic layout

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

// GiAbstract SVG icons for React rendering (legend, table, badges)
const TYPE_ICONS: Record<string, React.ReactNode> = {
  preference: <GiAbstract074 size={14} />,
  semantic: <GiAbstract076 size={14} />,
  procedural: <GiAbstract098 size={14} />,
  episodic: <GiAbstract060 size={14} />,
  fact: <GiAbstract008 size={14} />,
};

import { TYPE_SVG_PATHS } from "@/lib/type-svg-paths";

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
  const icon = TYPE_ICONS[type] || <Tag size={12} />;
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
// Heat Slider
// ---------------------------------------------------------------------------
function HeatSlider({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const color = heatColor(value);
  return (
    <div className="flex items-center gap-2 w-full">
      <Snowflake size={10} className="text-blue-500 shrink-0" />
      <input
        type="range"
        min={0} max={100} step={1}
        value={Math.round(value * 100)}
        onChange={e => onChange(Number(e.target.value) / 100)}
        disabled={disabled}
        className="flex-1 h-1 appearance-none bg-black/50 rounded-full cursor-pointer disabled:opacity-30"
        style={{
          accentColor: color,
          background: `linear-gradient(to right, ${color} ${value * 100}%, #111 ${value * 100}%)`,
        }}
      />
      <Flame size={10} className="text-[#D4AF37] shrink-0" />
      <span className="text-xs font-mono w-12 text-right" style={{ color }}>{value.toFixed(2)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact heat bar (non-interactive, for table rows)
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
// Main Page
// ---------------------------------------------------------------------------
export default function MemoriesPage() {
  // --- Graph state ---
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- Detail panel editing ---
  const [detailHeat, setDetailHeat] = useState(0);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailEditing, setDetailEditing] = useState(false);
  const [detailLabel, setDetailLabel] = useState("");
  const [detailType, setDetailType] = useState("");

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
  const [editHeat, setEditHeat] = useState(0);

  // View toggle
  const [view, setView] = useState<"both" | "graph" | "table">("both");

  const { graph, memories, deleteNode, patchNode, refreshAll } = useSulcusApi({
    page, page_size: pageSize,
    memory_type: typeFilter || undefined,
    search: searchText || undefined,
    pinned: pinnedFilter || undefined,
    sort: sortField, order: sortOrder,
  });

  // Sync detail panel state when selected node changes
  useEffect(() => {
    if (selected) {
      setDetailHeat(selected.heat);
      setDetailEditing(false);
      setDetailLabel(selected.label);
      setDetailType(selected.memory_type);
    }
  }, [selected]);

  // Derive graph data — nodes from API, synthetic edges
  const rawGraph = graph.data ?? { nodes: [], links: [] };
  const graphNodes = rawGraph.nodes;

  // Generate synthetic edges: chain within same type + cross-type for similar heat
  const graphEdges = (() => {
    if (rawGraph.links.length > 0) return rawGraph.links;
    const edges: { source: string; target: string; weight: number }[] = [];
    const byType: Record<string, typeof graphNodes> = {};
    graphNodes.forEach(n => { (byType[n.memory_type] ??= []).push(n); });
    // Chain within type
    Object.values(byType).forEach(group => {
      for (let i = 0; i < group.length - 1; i++) {
        edges.push({ source: group[i].id, target: group[i + 1].id, weight: 0.6 });
      }
    });
    // Cross-type for similar heat
    for (let i = 0; i < graphNodes.length; i++) {
      for (let j = i + 1; j < graphNodes.length; j++) {
        if (graphNodes[i].memory_type !== graphNodes[j].memory_type
          && Math.abs(graphNodes[i].heat - graphNodes[j].heat) < 0.12
          && graphNodes[i].heat > 0.6) {
          edges.push({ source: graphNodes[i].id, target: graphNodes[j].id, weight: 0.25 });
        }
      }
    }
    return edges;
  })();

  // Pre-compiled Path2D objects for each memory type (512x512 SVG viewBox)
  const svgPathCache = useRef<Map<string, Path2D>>(new Map());
  const getSvgPath = useCallback((type: string): Path2D | null => {
    const cache = svgPathCache.current;
    if (cache.has(type)) return cache.get(type)!;
    const d = TYPE_SVG_PATHS[type];
    if (!d) return null;
    try {
      const p = new Path2D(d);
      cache.set(type, p);
      return p;
    } catch {
      return null;
    }
  }, []);

  // Deterministic layout: place nodes in concentric arcs by type, evenly spaced.
  // Returns a stable map of id → {x, y} in canvas pixel coords.
  const layoutPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  const computeLayout = useCallback((width: number, height: number) => {
    const cx = width / 2;
    const cy = height / 2;
    const positions = new Map<string, { x: number; y: number }>();
    const types = Object.keys(TYPE_COLORS);
    const byType: Record<string, GraphNode[]> = {};
    graphNodes.forEach(n => { (byType[n.memory_type] ??= []).push(n); });

    const typeCount = types.filter(t => byType[t]?.length).length;
    const baseRadius = Math.min(width, height) * 0.32;

    let typeIdx = 0;
    for (const type of types) {
      const group = byType[type];
      if (!group?.length) continue;
      // Each type gets a ring at a different radius
      const ring = baseRadius * (0.4 + (typeIdx / Math.max(typeCount - 1, 1)) * 0.6);
      // Spread nodes evenly around their arc segment
      const arcPerType = (2 * Math.PI) / typeCount;
      const arcStart = typeIdx * arcPerType - Math.PI / 2;
      for (let i = 0; i < group.length; i++) {
        const angle = arcStart + (i / Math.max(group.length - 1, 1)) * arcPerType * 0.85;
        positions.set(group[i].id, {
          x: cx + Math.cos(angle) * ring,
          y: cy + Math.sin(angle) * ring,
        });
      }
      typeIdx++;
    }
    layoutPositions.current = positions;
    return positions;
  }, [graphNodes]);

  // Draw the static graph on canvas
  const drawGraph = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = view === "graph" ? 600 : 420;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.fillStyle = "#050a0f";
    ctx.fillRect(0, 0, w, h);

    const positions = computeLayout(w, h);
    const idMap = new Map(graphNodes.map(n => [n.id, n]));

    // Draw edges first (below nodes)
    for (const edge of graphEdges) {
      const p1 = positions.get(edge.source as string);
      const p2 = positions.get(edge.target as string);
      if (!p1 || !p2) continue;
      const weight = edge.weight || 0.3;
      const alpha = 0.15 + weight * 0.35;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = `rgba(212, 175, 55, ${alpha})`;
      ctx.lineWidth = 0.5 + weight * 1.5;
      if (weight < 0.4) ctx.setLineDash([4, 4]);
      else ctx.setLineDash([]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw nodes
    for (const node of graphNodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const { x, y } = pos;
      const heat = node.heat ?? 0.5;
      const r = 8 + heat * 10; // 8px to 18px radius
      const color = nodeColor(node.memory_type);
      const isSel = selected?.id === node.id;
      const isHov = hoverNode?.id === node.id;

      // Glow for hot nodes
      if (heat > 0.6) {
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, 2 * Math.PI);
        ctx.fillStyle = `${color}15`;
        ctx.fill();
      }

      // Selection / hover ring
      if (isSel || isHov) {
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, 2 * Math.PI);
        ctx.strokeStyle = isSel ? "#fff" : `${color}88`;
        ctx.lineWidth = isSel ? 2.5 : 1.5;
        ctx.stroke();
      }

      // Main disk
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "#0d1a28");
      grad.addColorStop(0.7, "#0a1520");
      grad.addColorStop(1, `${color}33`);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = `${color}${isSel ? "cc" : isHov ? "99" : "66"}`;
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.stroke();

      // SVG icon
      const svgPath = getSvgPath(node.memory_type);
      if (svgPath) {
        const iconSize = r * 1.4;
        const scale = iconSize / 512;
        ctx.save();
        ctx.translate(x - iconSize / 2, y - iconSize / 2);
        ctx.scale(scale, scale);
        ctx.fillStyle = color;
        ctx.globalAlpha = isSel ? 1 : isHov ? 0.95 : 0.85;
        ctx.fill(svgPath);
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      // Label for selected/hovered
      if ((isSel || isHov) && node.label) {
        const maxChars = 36;
        const lbl = node.label.length > maxChars ? node.label.slice(0, maxChars) + "…" : node.label;
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const metrics = ctx.measureText(lbl);
        const px = 5, py = 2;
        ctx.fillStyle = "#050a0fdd";
        ctx.fillRect(x - metrics.width / 2 - px, y + r + 5, metrics.width + px * 2, 15);
        ctx.fillStyle = isSel ? "#fff" : "#ccc";
        ctx.fillText(lbl, x, y + r + 5 + py);
      }
    }
  }, [graphNodes, graphEdges, selected, hoverNode, computeLayout, getSvgPath, view]);

  // Redraw when data or selection changes
  useEffect(() => { drawGraph(); }, [drawGraph]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => drawGraph());
    ro.observe(container);
    return () => ro.disconnect();
  }, [drawGraph]);

  // Canvas click handler — find nearest node by distance
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const positions = layoutPositions.current;
    let closest: GraphNode | null = null;
    let closestDist = Infinity;
    for (const node of graphNodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const dx = mx - pos.x, dy = my - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) { closestDist = dist; closest = node; }
    }
    // 30px click radius
    if (closest && closestDist < 30) {
      setSelected(closest);
    } else {
      setSelected(null);
    }
  }, [graphNodes]);

  // Canvas hover handler — cursor + hover state
  const handleCanvasMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const positions = layoutPositions.current;
    let closest: GraphNode | null = null;
    let closestDist = Infinity;
    for (const node of graphNodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const dx = mx - pos.x, dy = my - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) { closestDist = dist; closest = node; }
    }
    if (closest && closestDist < 30) {
      canvas.style.cursor = "pointer";
      if (hoverNode?.id !== closest.id) setHoverNode(closest);
    } else {
      canvas.style.cursor = "default";
      if (hoverNode) setHoverNode(null);
    }
  }, [graphNodes, hoverNode]);

  // --- Graph callbacks ---

  // (old paintNode + getSvgPath moved above drawGraph)

  // (click/hover handlers are handleCanvasClick and handleCanvasMove above)

  // --- Actions ---
  const handleDelete = (id: string) => {
    if (!confirm("Permanently delete this memory node?")) return;
    deleteNode.mutate(id, { onSuccess: () => setSelected(null) });
  };

  const handleDetailHeatSave = () => {
    if (!selected) return;
    setDetailSaving(true);
    patchNode.mutate({ id: selected.id, patch: { current_heat: detailHeat } }, {
      onSuccess: () => setDetailSaving(false),
      onError: () => setDetailSaving(false),
    });
  };

  const togglePin = (node: MemoryNode) => {
    patchNode.mutate({ id: node.id, patch: { is_pinned: !node.is_pinned } });
  };

  const startEdit = (node: MemoryNode) => {
    setEditingId(node.id);
    setEditLabel(node.label);
    setEditType(node.memory_type);
    setEditHeat(node.heat);
  };
  const saveEdit = () => {
    if (!editingId) return;
    patchNode.mutate({ id: editingId, patch: { label: editLabel, memory_type: editType, current_heat: editHeat } }, { onSuccess: () => setEditingId(null) });
  };
  const cancelEdit = () => setEditingId(null);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const handleSearch = () => { setSearchText(searchInput); setPage(1); };

  const items = memories.data?.items ?? [];
  const total = memories.data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const typeCounts: Record<string, number> = {};
  graphNodes.forEach(n => { typeCounts[n.memory_type] = (typeCounts[n.memory_type] || 0) + 1; });

  return (
    <div className="flex flex-col gap-6 font-sans max-w-6xl">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
            <Brain size={20} className="text-[#00F0FF]" />
            Memory
          </h1>
          <p className="text-xs text-[#666] tracking-wider mt-1">
            {graphNodes.length} nodes · {graphEdges.length} edges · {total} indexed
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex border border-[#D4AF37]/20 text-[10px] uppercase tracking-widest">
            {([
              { key: "both" as const, icon: <Columns3 size={12} />, label: "Both" },
              { key: "graph" as const, icon: <LayoutGrid size={12} />, label: "Graph" },
              { key: "table" as const, icon: <Table2 size={12} />, label: "Table" },
            ]).map(v => (
              <button key={v.key} onClick={() => setView(v.key)}
                className={`px-3 py-1.5 transition-colors flex items-center gap-1.5 ${view === v.key ? "bg-[#D4AF37]/20 text-[#D4AF37]" : "text-[#555] hover:text-[#888]"}`}
                title={v.label}>
                {v.icon}
              </button>
            ))}
          </div>
          <button onClick={() => refreshAll()} disabled={graph.isRefetching || memories.isRefetching}
            className="text-xs text-[#00F0FF] border border-[#00F0FF]/30 px-3 py-1.5 hover:bg-[#00F0FF]/10 transition-colors uppercase tracking-widest flex items-center gap-2 disabled:opacity-50">
            <RefreshCw size={12} className={(graph.isRefetching || memories.isRefetching) ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Graph Section */}
      {(view === "graph" || view === "both") && (
        <div className="flex gap-4" style={{ minHeight: view === "graph" ? 600 : 420 }}>
          <div ref={containerRef} className="flex-1 bg-[#050a0f] border border-[#D4AF37]/20 relative overflow-hidden rounded-sm">
            {/* Legend */}
            <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-3 text-[10px] tracking-widest uppercase bg-[#050a0f]/90 backdrop-blur-sm px-3 py-2 border border-[#D4AF37]/15 rounded-sm pointer-events-none">
              {Object.entries(typeCounts).map(([type, count]) => (
                <span key={type} className="flex items-center gap-1.5">
                  <span style={{ color: nodeColor(type) }}>{TYPE_ICONS[type] ?? <span>●</span>}</span>
                  <span style={{ color: nodeColor(type) }}>{type}</span>
                  <span className="text-[#555]">({count})</span>
                </span>
              ))}
            </div>

            {graph.isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center text-[#555] animate-pulse tracking-widest text-sm uppercase">
                <Brain size={20} className="mr-2 animate-pulse" /> Loading graph…
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                onMouseMove={handleCanvasMove}
                onMouseLeave={() => { setHoverNode(null); }}
                style={{ width: "100%", height: view === "graph" ? 600 : 420, display: "block" }}
              />
            )}
          </div>

          {/* Detail panel — edit/steer memories */}
          {selected && (
            <div className="w-80 bg-[#0a1520] border border-[#D4AF37]/30 p-5 flex flex-col gap-4 overflow-y-auto shrink-0 rounded-sm">
              <div className="flex justify-between items-start">
                <h2 className="text-xs font-bold text-[#D4AF37] tracking-widest uppercase flex items-center gap-2">
                  <Zap size={12} /> {detailEditing ? "Edit Memory" : "Node Detail"}
                </h2>
                <div className="flex items-center gap-1">
                  {!detailEditing && (
                    <button onClick={() => { setDetailEditing(true); setDetailLabel(selected.label); setDetailType(selected.memory_type); }}
                      className="text-[#555] hover:text-[#00F0FF] transition-colors" title="Edit"><Pencil size={14} /></button>
                  )}
                  <button onClick={() => { setSelected(null); setDetailEditing(false); }} className="text-[#555] hover:text-white transition-colors"><X size={14} /></button>
                </div>
              </div>

              {/* Type — editable or badge */}
              <div>
                <span className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Type</span>
                {detailEditing ? (
                  <select value={detailType} onChange={e => setDetailType(e.target.value)}
                    className="w-full bg-[#111820] border border-[#D4AF37]/50 text-white text-xs px-2 py-1.5 focus:outline-none rounded-sm">
                    {MEMORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                ) : (
                  <TypeBadge type={selected.memory_type} />
                )}
              </div>

              {/* Heat with slider */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Thermometer size={12} className="text-[#D4AF37]" />
                  <span className="text-xs text-[#888] uppercase tracking-wider">Heat</span>
                  <span className="text-[10px] uppercase tracking-wider ml-auto" style={{ color: heatColor(detailHeat) }}>
                    {heatLabel(detailHeat)}
                  </span>
                </div>
                <HeatSlider value={detailHeat} onChange={setDetailHeat} />
              </div>

              {/* Utility */}
              <div className="flex items-center gap-2">
                <Gauge size={12} className="text-[#00F0FF]" />
                <span className="text-xs text-[#888] uppercase tracking-wider">Utility</span>
                <span className="text-sm font-mono text-[#00F0FF] ml-auto">—</span>
              </div>

              {/* ID */}
              <div className="flex items-center gap-2">
                <Hash size={12} className="text-[#666]" />
                <span className="text-[10px] font-mono text-[#444] break-all select-all">{selected.id}</span>
              </div>

              {/* Summary — editable or display */}
              <div className="flex-1">
                <p className="text-xs text-[#666] tracking-wider uppercase mb-1 flex items-center gap-1.5">
                  <BookOpen size={10} /> Summary
                </p>
                {detailEditing ? (
                  <textarea value={detailLabel} onChange={e => setDetailLabel(e.target.value)}
                    rows={6} className="w-full text-xs text-white leading-relaxed bg-[#050a0f] border border-[#D4AF37]/50 p-3 rounded-sm focus:outline-none focus:border-[#D4AF37] resize-y"
                    placeholder="Describe this memory…" />
                ) : (
                  <div className="text-xs text-[#ccc] leading-relaxed bg-[#050a0f] border border-[#333] p-3 max-h-48 overflow-y-auto rounded-sm">
                    {selected.label || "(empty)"}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="border-t border-[#D4AF37]/20 pt-3 flex flex-col gap-2">
                {detailEditing ? (
                  <div className="flex gap-2">
                    <button onClick={() => {
                      const patch: Record<string, any> = {};
                      if (detailLabel !== selected.label) patch.label = detailLabel;
                      if (detailType !== selected.memory_type) patch.memory_type = detailType;
                      if (detailHeat !== selected.heat) patch.current_heat = detailHeat;
                      if (Object.keys(patch).length > 0) {
                        setDetailSaving(true);
                        patchNode.mutate({ id: selected.id, patch }, {
                          onSuccess: () => { setDetailSaving(false); setDetailEditing(false); },
                          onError: () => setDetailSaving(false),
                        });
                      } else {
                        setDetailEditing(false);
                      }
                    }} disabled={detailSaving}
                      className="flex-1 text-xs text-[#050a0f] bg-[#D4AF37] px-3 py-2 hover:brightness-110 transition-all uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 rounded-sm font-bold">
                      <Check size={12} /> {detailSaving ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => { setDetailEditing(false); setDetailHeat(selected.heat); }}
                      className="flex-1 text-xs text-[#888] border border-[#555]/30 px-3 py-2 hover:bg-[#555]/10 transition-colors uppercase tracking-widest flex items-center justify-center gap-2 rounded-sm">
                      <X size={12} /> Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {detailHeat !== selected.heat && (
                      <button onClick={handleDetailHeatSave} disabled={detailSaving}
                        className="flex-1 text-xs text-[#D4AF37] border border-[#D4AF37]/30 px-3 py-2 hover:bg-[#D4AF37]/10 transition-colors uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 rounded-sm">
                        {detailSaving ? "Saving…" : "Apply Heat"}
                      </button>
                    )}
                    <button onClick={() => handleDelete(selected.id)} disabled={deleteNode.isPending}
                      className="flex-1 text-xs text-red-500 border border-red-500/30 px-3 py-2 hover:bg-red-500/10 transition-colors uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 rounded-sm">
                      <Trash2 size={12} /> Delete
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
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
                <input value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()}
                  placeholder="Search memories…" className="bg-[#0a1520] border border-[#D4AF37]/20 text-white text-sm pl-9 pr-3 py-2 w-56 focus:outline-none focus:border-[#D4AF37]/50 placeholder-[#333] rounded-sm" />
              </div>
              <button onClick={handleSearch} className="bg-[#0a1520] border border-[#D4AF37]/20 border-l-0 px-3 py-2 text-[#555] hover:text-[#D4AF37] rounded-r-sm"><Filter size={14} /></button>
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
                <X size={12} /> Clear
              </button>
            )}
          </div>

          {/* Table */}
          <div className="bg-[#0a1520] border border-[#D4AF37]/30 shadow-[0_0_20px_rgba(0,0,0,0.5)] relative overflow-x-auto rounded-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#111820] text-[#D4AF37] text-xs uppercase tracking-widest border-b border-[#D4AF37]/30">
                <tr>
                  <th className="p-3 w-8"></th>
                  <th className="p-3 w-10"><Pin size={12} className="text-[#555]" /></th>
                  <th className="p-3">Summary</th>
                  <th className="p-3 w-28">Type</th>
                  <th className="p-3 w-40">
                    <span className="flex items-center gap-1"><Thermometer size={12} /> Heat</span>
                  </th>
                  <th className="p-3 w-20"><Clock size={12} className="inline mr-1" />Age</th>
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
                          // Don't toggle if clicking interactive elements (buttons, inputs, selects)
                          const tag = (e.target as HTMLElement).tagName;
                          if (tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || (e.target as HTMLElement).closest("button")) return;
                          toggleExpand(node.id);
                        }}>
                        <td className="p-3"><span className="text-[#555] group-hover:text-[#D4AF37] transition-colors">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevRight size={14} />}
                        </span></td>
                        <td className="p-3"><button onClick={(e) => { e.stopPropagation(); togglePin(node); }}
                          className={`transition-colors ${node.is_pinned ? "text-[#D4AF37]" : "text-[#333] hover:text-[#555]"}`}>
                          {node.is_pinned ? <Pin size={14} /> : <PinOff size={14} />}
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
                          <Clock size={10} />{relative}
                        </span></td>
                        <td className="p-3">{isEditing ? (
                          <div className="flex gap-1">
                            <button onClick={saveEdit} className="text-green-500 p-1 hover:bg-green-500/10 rounded-sm" title="Save"><Check size={14} /></button>
                            <button onClick={cancelEdit} className="text-red-500 p-1 hover:bg-red-500/10 rounded-sm" title="Cancel"><X size={14} /></button>
                          </div>
                        ) : (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => startEdit(node)} className="text-[#555] hover:text-[#00F0FF] p-1 rounded-sm" title="Edit"><Pencil size={14} /></button>
                            <button onClick={() => handleDelete(node.id)} className="text-[#555] hover:text-red-500 p-1 rounded-sm" title="Delete"><Trash2 size={14} /></button>
                          </div>
                        )}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-[#060d14]"><td colSpan={7} className="p-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs mb-3">
                            <div>
                              <span className="text-[#555] uppercase tracking-wider block mb-1 flex items-center gap-1"><Gauge size={10} /> Utility</span>
                              <span className="text-white font-mono">{node.base_utility.toFixed(3)}</span>
                            </div>
                            <div>
                              <span className="text-[#555] uppercase tracking-wider block mb-1 flex items-center gap-1"><Brain size={10} /> Modality</span>
                              <span className="text-white">{node.modality}</span>
                            </div>
                            <div>
                              <span className="text-[#555] uppercase tracking-wider block mb-1 flex items-center gap-1"><Tag size={10} /> Namespace</span>
                              <span className="text-white">{node.namespace}</span>
                            </div>
                            <div>
                              <span className="text-[#555] uppercase tracking-wider block mb-1 flex items-center gap-1"><Hash size={10} /> ID</span>
                              <span className="text-[#555] font-mono text-[10px] break-all select-all">{node.id}</span>
                            </div>
                          </div>
                          <div className="mb-3">
                            <span className="text-[#555] uppercase tracking-wider text-xs flex items-center gap-1 mb-1"><Thermometer size={10} /> Heat Control</span>
                            <div className="max-w-sm">
                              <HeatSlider value={node.heat} onChange={(v) => patchNode.mutate({ id: node.id, patch: { current_heat: v } })} />
                            </div>
                          </div>
                          <pre className="text-[#999] text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto bg-black/30 p-3 border border-[#D4AF37]/10 rounded-sm">{node.label}</pre>
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
                <button onClick={() => setPage(1)} disabled={page === 1} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20"><ChevronsLeft size={14} /></button>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20"><ChevronLeft size={14} /></button>
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
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20"><ChevronRight size={14} /></button>
                <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20"><ChevronsRight size={14} /></button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}