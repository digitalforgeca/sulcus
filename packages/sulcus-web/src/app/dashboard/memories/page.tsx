"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState, Fragment, useMemo } from "react";
import ReactMarkdown from "react-markdown";
// No dynamic import — using custom static canvas graph (no d3/force simulation)
import {
  TbRefresh, TbTrash, TbX, TbFlame, TbTag, TbHash, TbTemperature,
  TbPin, TbPinnedOff, TbPencil, TbCheck, TbSearch, TbFilter, TbGauge,
  TbChevronLeft, TbChevronRight, TbChevronsLeft, TbChevronsRight,
  TbChevronDown, TbSnowflake,
  TbAtom, TbBook, TbHeart, TbBulb, TbClock, TbBolt,
  TbLayoutGrid, TbTable, TbColumns3,
} from "react-icons/tb";
import {
  GiAbstract074, // preference — orbital/molecular
  GiAbstract076, // semantic — branching network
  GiAbstract098, // procedural — grid/hash structure
  GiAbstract060, // episodic — compass/portal
  GiAbstract008, // fact — starburst
} from "react-icons/gi";
import { useSulcusApi, type GraphNode, type MemoryNode } from "@/hooks/useSulcusApi";
import { usePolling } from "@/hooks/usePolling";
import { useToast } from "@/components/toast";

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
// Rendered Markdown (read-only, themed for Sulcus dark/gold UI)
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
// Heat slider with local state (for table rows — commits only on mouseup)
// ---------------------------------------------------------------------------
function CommitHeatSlider({ initialValue, onCommit }: { initialValue: number; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState(initialValue);
  useEffect(() => { setLocal(initialValue); }, [initialValue]);
  return <HeatSlider value={local} onChange={setLocal} onCommit={onCommit} />;
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

  // Zoom + pan state
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOffsetStart = useRef({ x: 0, y: 0 });

  // Create memory modal
  const [showCreate, setShowCreate] = useState(false);
  const [createLabel, setCreateLabel] = useState("");
  const [createType, setCreateType] = useState("episodic");
  const [createHeat, setCreateHeat] = useState(0.8);

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

  // Graph limit — start with 200, user can load more
  const [graphLimit, setGraphLimit] = useState(200);

  const { graph, memories, deleteNode, patchNode, createNode, refreshAll } = useSulcusApi({
    page, page_size: pageSize,
    memory_type: typeFilter || undefined,
    search: searchText || undefined,
    pinned: pinnedFilter || undefined,
    sort: sortField, order: sortOrder,
    graph_limit: graphLimit,
  });

  const toast = useToast();
  const prevNodeCount = useRef<number | null>(null);

  // Smart polling — only polls when tab is visible, 30s interval, 10s manual cooldown
  const { isRefreshing: isPolling, lastUpdated, refresh: pollingRefresh, cooldownRemaining } = usePolling({
    fetcher: async () => { refreshAll(); },
    interval: 30_000,
  });

  // Detect new memories and fire toast
  useEffect(() => {
    const total = graph.data?.nodes?.length;
    if (total == null) return;
    if (prevNodeCount.current !== null && total > prevNodeCount.current) {
      const diff = total - prevNodeCount.current;
      toast.success(`${diff} new memor${diff === 1 ? "y" : "ies"} stored`);
    }
    prevNodeCount.current = total;
  }, [graph.data?.nodes?.length]);

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
    const totalNodes = graphNodes.length;

    // ── Group by namespace first, then by type within each namespace ──
    const byNamespace: Record<string, GraphNode[]> = {};
    graphNodes.forEach(n => {
      const ns = n.namespace || "default";
      (byNamespace[ns] ??= []).push(n);
    });
    const namespaces = Object.keys(byNamespace).sort();
    const nsCount = namespaces.length;

    // ── Dynamic scaling: more nodes = more spread ──
    const minNodeSpacing = 40;
    // Scale canvas utilisation with node count — sqrt gives diminishing spread
    const spreadFactor = Math.max(1, Math.sqrt(totalNodes / 50));
    const baseRadius = Math.min(
      Math.max(width, height) * 0.85,
      Math.max(Math.min(width, height) * 0.35, (totalNodes * minNodeSpacing) / (2 * Math.PI) * spreadFactor)
    );

    // ── Namespace cluster separation ──
    // Each namespace gets a sector of the circle, with padding between clusters
    const sectorPadding = nsCount > 1 ? 0.15 : 0; // radians gap between clusters
    const totalPadding = sectorPadding * nsCount;
    const availableArc = 2 * Math.PI - totalPadding;

    let currentAngle = -Math.PI / 2; // start at top

    for (let nsIdx = 0; nsIdx < nsCount; nsIdx++) {
      const ns = namespaces[nsIdx];
      const nsNodes = byNamespace[ns];
      const nsNodeCount = nsNodes.length;

      // Proportional arc for this namespace
      const nsArc = (nsNodeCount / Math.max(totalNodes, 1)) * availableArc;
      const actualArc = Math.max(nsArc, 0.3); // minimum arc so tiny namespaces are visible

      // Namespace cluster center angle
      const clusterCenterAngle = currentAngle + actualArc / 2;

      // ── Within namespace: sub-group by memory type ──
      const byType: Record<string, GraphNode[]> = {};
      nsNodes.forEach(n => { (byType[n.memory_type] ??= []).push(n); });
      const types = Object.keys(byType).sort();
      const typeCount = types.length;

      // Spread types across concentric rings within the namespace sector
      let nodeIdx = 0;
      for (let tIdx = 0; tIdx < typeCount; tIdx++) {
        const group = byType[types[tIdx]];
        if (!group?.length) continue;

        // Each type gets a different ring distance from the namespace center
        const ringOffset = typeCount > 1
          ? (tIdx / (typeCount - 1)) * 0.5 - 0.25  // -0.25 to +0.25 variation
          : 0;
        const ringRadius = baseRadius * (0.4 + 0.4 * (nsIdx / Math.max(nsCount - 1, 1)) + ringOffset);

        for (let i = 0; i < group.length; i++) {
          // Distribute nodes along the namespace's arc
          const t = nsNodeCount === 1 ? 0.5 : nodeIdx / (nsNodeCount - 1);
          const angle = currentAngle + t * actualArc;

          // Jitter for large groups: alternate between inner/outer rings
          const jitter = group.length > 15 ? (i % 3 - 1) * minNodeSpacing * 0.5 : 0;
          const r = ringRadius + jitter;

          positions.set(group[i].id, {
            x: cx + Math.cos(angle) * r,
            y: cy + Math.sin(angle) * r,
          });
          nodeIdx++;
        }
      }

      currentAngle += actualArc + sectorPadding;
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
    // Scale graph height with node count — more nodes need more room
    const graphH = Math.max(700, Math.min(1200, graphNodes.length * 6));
    const h = view === "graph" ? graphH : 420;
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

    // Apply zoom + pan transform
    ctx.save();
    ctx.translate(w / 2 + panOffset.x, h / 2 + panOffset.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-w / 2, -h / 2);

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
    // ── Draw namespace cluster labels ──
    const cx = w / 2;
    const cy = h / 2;
    const byNs: Record<string, Array<{ x: number; y: number }>> = {};
    for (const node of graphNodes) {
      const ns = node.namespace || "default";
      const pos = positions.get(node.id);
      if (pos) (byNs[ns] ??= []).push(pos);
    }
    const nsColors: Record<string, string> = {};
    const NS_PALETTE = ["#D4AF37", "#00F0FF", "#FF6B6B", "#50FA7B", "#BD93F9", "#FFB86C", "#FF79C6", "#8BE9FD"];
    Object.keys(byNs).sort().forEach((ns, i) => { nsColors[ns] = NS_PALETTE[i % NS_PALETTE.length]; });

    for (const [ns, nsPositions] of Object.entries(byNs)) {
      if (nsPositions.length === 0) continue;
      // Find centroid of the namespace cluster
      const avgX = nsPositions.reduce((s, p) => s + p.x, 0) / nsPositions.length;
      const avgY = nsPositions.reduce((s, p) => s + p.y, 0) / nsPositions.length;
      // Find the outermost point from center to place label outside the cluster
      const maxDist = nsPositions.reduce((mx, p) => {
        const d = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
        return Math.max(mx, d);
      }, 0);
      // Place label at the cluster centroid, pushed outward
      const angle = Math.atan2(avgY - cy, avgX - cx);
      const labelR = maxDist + 35;
      const lx = cx + Math.cos(angle) * labelR;
      const ly = cy + Math.sin(angle) * labelR;

      ctx.save();
      ctx.font = "bold 11px 'SF Mono', 'Fira Code', monospace";
      ctx.fillStyle = nsColors[ns] ?? "#D4AF37";
      ctx.globalAlpha = 0.8;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ns.toUpperCase(), lx, ly);

      // Draw a subtle arc to delineate the namespace sector
      if (Object.keys(byNs).length > 1 && nsPositions.length > 2) {
        const angles = nsPositions.map(p => Math.atan2(p.y - cy, p.x - cx));
        const minAngle = Math.min(...angles) - 0.05;
        const maxAngle = Math.max(...angles) + 0.05;
        ctx.beginPath();
        ctx.arc(cx, cy, maxDist + 15, minAngle, maxAngle);
        ctx.strokeStyle = nsColors[ns] ?? "#D4AF37";
        ctx.globalAlpha = 0.15;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore(); // end zoom/pan transform
  }, [graphNodes, graphEdges, selected, hoverNode, computeLayout, getSvgPath, view, zoom, panOffset]);

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

  // Convert screen coords to graph coords (accounting for zoom + pan)
  const screenToGraph = useCallback((screenX: number, screenY: number, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const sx = screenX - rect.left;
    const sy = screenY - rect.top;
    // Invert the transform: translate(w/2+pan) → scale(zoom) → translate(-w/2)
    const gx = (sx - w / 2 - panOffset.x) / zoom + w / 2;
    const gy = (sy - h / 2 - panOffset.y) / zoom + h / 2;
    return { x: gx, y: gy };
  }, [zoom, panOffset]);

  // Find nearest node to graph coords
  const findNearestNode = useCallback((gx: number, gy: number): { node: GraphNode | null; dist: number } => {
    const positions = layoutPositions.current;
    let closest: GraphNode | null = null;
    let closestDist = Infinity;
    for (const node of graphNodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const dx = gx - pos.x, dy = gy - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) { closestDist = dist; closest = node; }
    }
    return { node: closest, dist: closestDist };
  }, [graphNodes]);

  // Canvas click handler — selection now handled in mouseUp (drag-aware)
  // This is a no-op; kept for React event prop compatibility
  const handleCanvasClick = useCallback((_e: React.MouseEvent<HTMLCanvasElement>) => {
    // Selection logic moved to handleCanvasMouseUp to distinguish click from drag
  }, []);

  // Canvas hover + pan handler
  const handleCanvasMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Handle panning (any button drag)
    if (isPanning.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Only start visual pan after exceeding drag threshold
      if (dist >= DRAG_THRESHOLD) {
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = "grabbing";
        setPanOffset({
          x: panOffsetStart.current.x + dx,
          y: panOffsetStart.current.y + dy,
        });
      }
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = screenToGraph(e.clientX, e.clientY, canvas);
    const { node, dist } = findNearestNode(g.x, g.y);
    if (node && dist < 30 / zoom) {
      canvas.style.cursor = "pointer";
      if (hoverNode?.id !== node.id) setHoverNode(node);
    } else {
      canvas.style.cursor = "grab";
      if (hoverNode) setHoverNode(null);
    }
  }, [screenToGraph, findNearestNode, zoom, hoverNode]);

  // Smooth zoom via scroll wheel / trackpad — uses native listener for preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.ctrlKey ? -e.deltaY * 0.01 : -e.deltaY * 0.002;
      setZoom(z => Math.min(5, Math.max(0.3, z * (1 + delta))));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [graphNodes]); // re-attach when graph data changes (canvas may remount)

  // No-op React handler — native listener handles wheel
  const handleCanvasWheel = useCallback((_e: React.WheelEvent<HTMLCanvasElement>) => {}, []);

  // Mouse down/up for panning — left-click drag (trackpad friendly)
  const DRAG_THRESHOLD = 5; // px — below this is a click, above is a pan
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Any mouse button starts a potential pan
    if (e.button === 0 || e.button === 1 || e.button === 2) {
      e.preventDefault();
      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY };
      panOffsetStart.current = { ...panOffset };
    }
  }, [panOffset]);

  const handleCanvasMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // If dragged less than threshold, treat as click (select node)
      if (dist < DRAG_THRESHOLD) {
        isPanning.current = false;
        const canvas = canvasRef.current;
        if (canvas) {
          const g = screenToGraph(e.clientX, e.clientY, canvas);
          const { node, dist: nodeDist } = findNearestNode(g.x, g.y);
          if (node && nodeDist < 30 / zoom) {
            setSelected(node);
          } else {
            setSelected(null);
          }
        }
      }
    }
    isPanning.current = false;
  }, [screenToGraph, findNearestNode, zoom]);

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
      onSuccess: () => {
        setDetailSaving(false);
        setSelected(prev => prev ? { ...prev, heat: detailHeat } : null);
      },
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
  const nsCounts: Record<string, number> = {};
  graphNodes.forEach(n => { const ns = n.namespace || "default"; nsCounts[ns] = (nsCounts[ns] || 0) + 1; });
  const NS_LEGEND_COLORS = ["#D4AF37", "#00F0FF", "#FF6B6B", "#50FA7B", "#BD93F9", "#FFB86C", "#FF79C6", "#8BE9FD"];
  const nsLegend = Object.keys(nsCounts).sort().map((ns, i) => ({ ns, count: nsCounts[ns], color: NS_LEGEND_COLORS[i % NS_LEGEND_COLORS.length] }));

  return (
    <div className="flex flex-col gap-6 font-sans max-w-6xl">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
            <TbAtom size={20} className="text-[#00F0FF]" />
            Memory
          </h1>
          <p className="text-xs text-[#666] tracking-wider mt-1">
            {graphNodes.length}{graph.data?.total_nodes && graph.data.total_nodes > graphNodes.length ? ` / ${graph.data.total_nodes}` : ""} nodes · {graphEdges.length} edges · {total} indexed
            {graph.data?.total_nodes && graph.data.total_nodes > graphLimit && (
              <button
                onClick={() => setGraphLimit(prev => Math.min(prev + 200, graph.data?.total_nodes ?? prev + 200))}
                className="ml-3 text-[#00F0FF] hover:text-[#00F0FF]/70 transition-colors"
              >
                load more ↓
              </button>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
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
            onClick={pollingRefresh}
            disabled={cooldownRemaining > 0 || isPolling || graph.isRefetching}
            title={cooldownRemaining > 0 ? `Cooldown: ${cooldownRemaining}s` : lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Refresh"}
            className="text-xs text-[#00F0FF] border border-[#00F0FF]/30 px-3 py-1.5 hover:bg-[#00F0FF]/10 transition-colors uppercase tracking-widest flex items-center gap-2 disabled:opacity-40"
          >
            <TbRefresh size={12} className={(isPolling || graph.isRefetching || memories.isRefetching) ? "animate-spin" : ""} />
            {cooldownRemaining > 0 && <span className="font-mono text-[9px]">{cooldownRemaining}s</span>}
          </button>
        </div>
      </div>

      {/* Graph Section */}
      {(view === "graph" || view === "both") && (
        <div className="flex gap-4" style={{ minHeight: view === "graph" ? Math.max(700, Math.min(1200, graphNodes.length * 6)) : 420 }}>
          <div ref={containerRef} className="flex-1 bg-[#050a0f] border border-[#D4AF37]/20 relative overflow-hidden rounded-sm">
            {/* Legend: types + namespaces */}
            <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 text-[10px] tracking-widest uppercase bg-[#050a0f]/90 backdrop-blur-sm px-3 py-2 border border-[#D4AF37]/15 rounded-sm pointer-events-none">
              <div className="flex flex-wrap gap-3">
                {Object.entries(typeCounts).map(([type, count]) => (
                  <span key={type} className="flex items-center gap-1.5">
                    <span style={{ color: nodeColor(type) }}>{TYPE_ICONS[type] ?? <span>●</span>}</span>
                    <span style={{ color: nodeColor(type) }}>{type}</span>
                    <span className="text-[#555]">({count})</span>
                  </span>
                ))}
              </div>
              {nsLegend.length > 1 && (
                <div className="flex flex-wrap gap-3 border-t border-[#333] pt-1.5 mt-0.5">
                  {nsLegend.map(({ ns, count, color }) => (
                    <span key={ns} className="flex items-center gap-1.5">
                      <span style={{ color, fontSize: 8 }}>◆</span>
                      <span style={{ color }}>{ns}</span>
                      <span className="text-[#555]">({count})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Zoom controls */}
            <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2 bg-[#050a0f]/90 backdrop-blur-sm px-2 py-1 border border-[#D4AF37]/15 rounded-sm pointer-events-auto">
              <button onClick={() => setZoom(z => Math.min(5, z * 1.3))} className="text-[#555] hover:text-[#D4AF37] text-xs font-mono px-1">+</button>
              <span className="text-[10px] text-[#555] font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.max(0.3, z * 0.7))} className="text-[#555] hover:text-[#D4AF37] text-xs font-mono px-1">−</button>
              <button onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }} className="text-[10px] text-[#555] hover:text-[#00F0FF] uppercase tracking-wider ml-1">Reset</button>
            </div>

            {graph.isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center text-[#555] animate-pulse tracking-widest text-sm uppercase">
                <TbAtom size={20} className="mr-2 animate-pulse" /> Loading graph…
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                onMouseMove={handleCanvasMove}
                onMouseDown={handleCanvasMouseDown}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={() => { setHoverNode(null); isPanning.current = false; }}
                onWheel={handleCanvasWheel}
                onContextMenu={e => e.preventDefault()}
                onDragStart={e => e.preventDefault()}
                draggable={false}
                style={{ width: "100%", height: view === "graph" ? Math.max(700, Math.min(1200, graphNodes.length * 6)) : 420, display: "block", touchAction: "none", cursor: "grab", userSelect: "none", WebkitUserSelect: "none" }}
              />
            )}
          </div>

          {/* Detail panel — edit/steer memories */}
          {selected && (
            <div className="w-80 bg-[#0a1520] border border-[#D4AF37]/30 p-5 flex flex-col gap-4 overflow-y-auto shrink-0 rounded-sm">
              <div className="flex justify-between items-start">
                <h2 className="text-xs font-bold text-[#D4AF37] tracking-widest uppercase flex items-center gap-2">
                  <TbBolt size={12} /> {detailEditing ? "Edit Memory" : "Node Detail"}
                </h2>
                <div className="flex items-center gap-1">
                  {!detailEditing && (
                    <button onClick={() => { setDetailEditing(true); setDetailLabel(selected.label); setDetailType(selected.memory_type); }}
                      className="text-[#555] hover:text-[#00F0FF] transition-colors" title="Edit"><TbPencil size={14} /></button>
                  )}
                  <button onClick={() => { setSelected(null); setDetailEditing(false); }} className="text-[#555] hover:text-white transition-colors"><TbX size={14} /></button>
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
                  <TbTemperature size={12} className="text-[#D4AF37]" />
                  <span className="text-xs text-[#888] uppercase tracking-wider">Heat</span>
                  <span className="text-[10px] uppercase tracking-wider ml-auto" style={{ color: heatColor(detailHeat) }}>
                    {heatLabel(detailHeat)}
                  </span>
                </div>
                <HeatSlider value={detailHeat} onChange={setDetailHeat} />
              </div>

              {/* Utility */}
              <div className="flex items-center gap-2">
                <TbGauge size={12} className="text-[#00F0FF]" />
                <span className="text-xs text-[#888] uppercase tracking-wider">Utility</span>
                <span className="text-sm font-mono text-[#00F0FF] ml-auto">—</span>
              </div>

              {/* ID */}
              <div className="flex items-center gap-2">
                <TbHash size={12} className="text-[#666]" />
                <span className="text-[10px] font-mono text-[#444] break-all select-all">{selected.id}</span>
              </div>

              {/* Summary — editable or display */}
              <div className="flex-1">
                <p className="text-xs text-[#666] tracking-wider uppercase mb-1 flex items-center gap-1.5">
                  <TbBook size={10} /> Summary
                </p>
                {detailEditing ? (
                  <textarea value={detailLabel} onChange={e => setDetailLabel(e.target.value)}
                    rows={6} className="w-full text-xs text-white leading-relaxed bg-[#050a0f] border border-[#D4AF37]/50 p-3 rounded-sm focus:outline-none focus:border-[#D4AF37] resize-y"
                    placeholder="Describe this memory…" />
                ) : (
                  <div className="bg-[#050a0f] border border-[#333] p-3 max-h-48 overflow-y-auto rounded-sm">
                    {selected.label ? <RenderedMarkdown content={selected.label} /> : <span className="text-xs text-[#555]">(empty)</span>}
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
                          onSuccess: () => {
                            setDetailSaving(false);
                            setDetailEditing(false);
                            setSelected(prev => prev ? {
                              ...prev,
                              heat: patch.current_heat ?? prev.heat,
                              label: patch.label ?? prev.label,
                              memory_type: patch.memory_type ?? prev.memory_type,
                            } : null);
                          },
                          onError: () => setDetailSaving(false),
                        });
                      } else {
                        setDetailEditing(false);
                      }
                    }} disabled={detailSaving}
                      className="flex-1 text-xs text-[#050a0f] bg-[#D4AF37] px-3 py-2 hover:brightness-110 transition-all uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 rounded-sm font-bold">
                      <TbCheck size={12} /> {detailSaving ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => { setDetailEditing(false); setDetailHeat(selected.heat); }}
                      className="flex-1 text-xs text-[#888] border border-[#555]/30 px-3 py-2 hover:bg-[#555]/10 transition-colors uppercase tracking-widest flex items-center justify-center gap-2 rounded-sm">
                      <TbX size={12} /> Cancel
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
                  <th className="p-3 w-40">
                    <span className="flex items-center gap-1"><TbTemperature size={12} /> Heat</span>
                  </th>
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
                          // Don't toggle if clicking interactive elements (buttons, inputs, selects)
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
                              <CommitHeatSlider initialValue={node.heat} onCommit={(v) => patchNode.mutate({ id: node.id, patch: { current_heat: v } })} />
                            </div>
                          </div>
                          <div className="max-h-48 overflow-y-auto bg-black/30 p-3 border border-[#D4AF37]/10 rounded-sm">
                            <RenderedMarkdown content={node.label} />
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