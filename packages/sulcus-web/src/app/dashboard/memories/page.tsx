"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic2 from "next/dynamic";
import { RefreshCw, Trash2, X, Flame, Zap, Tag, Hash } from "lucide-react";
import { useSulcusApi, type GraphNode } from "@/hooks/useSulcusApi";

// react-force-graph-2d uses canvas — must be loaded client-only
const ForceGraph2D = dynamic2(
  () => import("react-force-graph-2d").then((m) => m.default || m),
  { ssr: false }
);

// ---------------------------------------------------------------------------
// Colour mapping
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, string> = {
  preference: "#D4AF37",
  semantic: "#00F0FF",
  procedural: "#8B5CF6",
  episodic: "#555",
  default: "#444",
};

function nodeColor(type: string): string {
  return TYPE_COLORS[type] || TYPE_COLORS.default;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MemoriesPage() {
  const { graph, deleteNode, refreshAll } = useSulcusApi();
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);

  // Responsive sizing
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: Math.max(500, rect.height) });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Node paint
  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D) => {
      const isSelected = selected?.id === node.id;
      const r = 4 + (node.heat ?? 0.5) * 8;
      const color = nodeColor(node.memory_type);

      // Glow for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI);
        ctx.fillStyle = `${color}44`;
        ctx.fill();
      }

      // Main circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      // Border
      ctx.strokeStyle = isSelected ? "#fff" : `${color}88`;
      ctx.lineWidth = isSelected ? 1.5 : 0.5;
      ctx.stroke();
    },
    [selected]
  );

  const handleNodeClick = useCallback((node: any) => {
    setSelected(node);
    // Zoom to node
    if (graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 400);
      graphRef.current.zoom(3, 400);
    }
  }, []);

  const handleDelete = (id: string) => {
    if (!confirm("Permanently delete this memory node?")) return;
    deleteNode.mutate(id, {
      onSuccess: () => setSelected(null),
    });
  };

  const graphData = graph.data ?? { nodes: [], links: [] };
  const typeCounts: Record<string, number> = {};
  graphData.nodes.forEach((n) => {
    typeCounts[n.memory_type] = (typeCounts[n.memory_type] || 0) + 1;
  });

  return (
    <div className="flex flex-col h-full gap-4 font-sans">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
            <div className="w-2 h-2 bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]" />
            Memory Graph
          </h1>
          <p className="text-xs text-[#666] tracking-wider mt-1">
            {graphData.nodes.length} nodes · {graphData.links.length} edges
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Legend */}
          <div className="flex gap-3 text-[10px] tracking-widest uppercase">
            {Object.entries(typeCounts).map(([type, count]) => (
              <span key={type} className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ backgroundColor: nodeColor(type) }}
                />
                <span className="text-[#888]">
                  {type} ({count})
                </span>
              </span>
            ))}
          </div>
          <button
            onClick={() => refreshAll()}
            disabled={graph.isRefetching}
            className="text-xs text-[#00F0FF] border border-[#00F0FF]/30 px-3 py-1.5 hover:bg-[#00F0FF]/10 transition-colors uppercase tracking-widest flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={12} className={graph.isRefetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {graph.error && (
        <div className="bg-red-950/30 border border-red-500/50 text-red-400 p-3 font-mono text-xs tracking-wider">
          {(graph.error as Error).message}
        </div>
      )}

      {/* Main area: graph + detail panel */}
      <div className="flex flex-1 gap-4 min-h-[500px]">
        {/* Graph */}
        <div
          ref={containerRef}
          className="flex-1 bg-[#050a0f] border border-[#D4AF37]/20 relative overflow-hidden"
        >
          {graph.isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center text-[#555] animate-pulse tracking-widest text-sm uppercase">
              Loading graph…
            </div>
          ) : (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              width={dimensions.width}
              height={dimensions.height}
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                const r = 4 + (node.heat ?? 0.5) * 8;
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 2, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              onNodeClick={handleNodeClick}
              linkColor={() => "#D4AF3744"}
              linkWidth={(link: any) => Math.max(0.5, (link.weight || 0.5) * 2)}
              backgroundColor="#050a0f"
              cooldownTicks={80}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
              nodeLabel={(node: any) => `${node.label?.slice(0, 60)}...`}
            />
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-80 bg-[#0a1520] border border-[#D4AF37]/30 p-4 flex flex-col gap-4 overflow-y-auto shrink-0">
            <div className="flex justify-between items-start">
              <h2 className="text-sm font-bold text-[#D4AF37] tracking-widest uppercase">
                Node Detail
              </h2>
              <button
                onClick={() => setSelected(null)}
                className="text-[#555] hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Type badge */}
            <div className="flex items-center gap-2">
              <Tag size={12} className="text-[#666]" />
              <span
                className="text-xs font-mono tracking-widest uppercase px-2 py-0.5 rounded"
                style={{
                  color: nodeColor(selected.memory_type),
                  borderColor: `${nodeColor(selected.memory_type)}44`,
                  borderWidth: 1,
                }}
              >
                {selected.memory_type}
              </span>
            </div>

            {/* Heat */}
            <div className="flex items-center gap-2">
              <Flame size={12} className="text-[#D4AF37]" />
              <span className="text-xs text-[#888] tracking-wider">Heat</span>
              <span className="text-sm font-mono text-[#D4AF37] ml-auto">
                {selected.heat.toFixed(3)}
              </span>
            </div>

            {/* Node ID */}
            <div className="flex items-center gap-2">
              <Hash size={12} className="text-[#666]" />
              <span className="text-[10px] font-mono text-[#555] break-all">
                {selected.id}
              </span>
            </div>

            {/* Summary / content */}
            <div className="flex-1">
              <p className="text-xs text-[#666] tracking-wider uppercase mb-1">Summary</p>
              <div className="text-sm text-[#ccc] leading-relaxed bg-[#050a0f] border border-[#333] p-3 max-h-60 overflow-y-auto font-mono text-xs">
                {selected.label || "(empty)"}
              </div>
            </div>

            {/* Actions */}
            <div className="border-t border-[#D4AF37]/20 pt-3 flex gap-2">
              <button
                onClick={() => handleDelete(selected.id)}
                disabled={deleteNode.isPending}
                className="flex-1 text-xs text-red-500 border border-red-500/30 px-3 py-2 hover:bg-red-500/10 transition-colors uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
