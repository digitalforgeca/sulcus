'use client';

import { useRef, useCallback, useMemo, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { TbAtom } from 'react-icons/tb';

// ─── Types ──────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  memory_type: string;
  heat: number;
  namespace?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

interface WebGLGraphProps {
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  view: 'both' | 'graph' | 'table';
  onSelectNode: (node: GraphNode | null) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  preference: '#D4AF37',
  fact: '#3498DB',
  procedural: '#00D68F',
  semantic: '#9B59B6',
  episodic: '#FF6B6B',
};

const NS_COLORS = ['#D4AF37', '#00F0FF', '#FF6B6B', '#50FA7B', '#BD93F9', '#FFB86C', '#FF79C6', '#8BE9FD'];

// ─── Color Interpolation (for resonance animation) ──────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
}

function lerpColor(from: string, to: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(from);
  const [r2, g2, b2] = hexToRgb(to);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

// Ease-out cubic for smooth animation
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// ─── BFS Layers (for resonance propagation) ─────────────────────────────────

function computeBfsLayers(graph: Graph, sourceId: string, maxDepth: number): Map<string, number> {
  const layers = new Map<string, number>();
  layers.set(sourceId, 0);
  let frontier = [sourceId];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const neighbor of graph.neighbors(nodeId)) {
        if (!layers.has(neighbor)) {
          layers.set(neighbor, depth);
          next.push(neighbor);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return layers;
}

function nodeColor(type: string): string {
  return TYPE_COLORS[type] || '#555';
}

// ─── Ring Layout ────────────────────────────────────────────────────────────

function computeRingLayout(
  nodes: GraphNode[],
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (!nodes.length) return positions;

  const n = nodes.length;

  // Sort by heat descending — hottest in center
  const sorted = [...nodes].sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0));

  const cx = width / 2;
  const cy = height / 2;

  // For very large graphs (> 3000 nodes), use a simplified spiral/grid hybrid
  // that avoids per-node trig calls from golden-angle jitter.
  if (n > 3000) {
    // Simplified spiral: pre-compute ring radii, skip jitter
    const countScale = Math.max(1, Math.sqrt(n / 100));
    const maxRadius = Math.min(width, height) * 0.45 * countScale;
    const nodeSpacing = 28;
    const minRingGap = 18;
    const sqrtN = Math.ceil(Math.sqrt(n));

    positions.set(sorted[0].id, { x: cx, y: cy });
    let placed = 1;
    let ringIndex = 1;

    while (placed < n) {
      const ringFraction = ringIndex / sqrtN;
      const radius = Math.max(maxRadius * ringFraction, ringIndex * minRingGap);
      const circumference = 2 * Math.PI * radius;
      const nodesInRing = Math.max(6, Math.floor(circumference / nodeSpacing));
      const count = Math.min(nodesInRing, n - placed);
      const angleStep = (2 * Math.PI) / count;
      const ringOffset = ringIndex * 0.3;

      for (let i = 0; i < count; i++) {
        const angle = angleStep * i + ringOffset;
        positions.set(sorted[placed].id, {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        });
        placed++;
      }
      ringIndex++;
    }
    return positions;
  }

  // Scale the graph radius with node count — more nodes need more room.
  // At 5K+ nodes, the base 0.45 multiplier packs them too tight.
  // Use sqrt scaling: 100 nodes → 0.45, 1000 → ~1.4, 5000 → ~3.2
  const countScale = Math.max(1, Math.sqrt(n / 100));
  const maxRadius = Math.min(width, height) * 0.45 * countScale;

  // Place hottest node at center
  positions.set(sorted[0].id, { x: cx, y: cy });

  // Fill rings outward — spacing per node controls density within each ring.
  // 28px gives comfortable breathing room at scale.
  const nodeSpacing = 28;
  // Ring gap — minimum distance between consecutive rings
  const minRingGap = 18;
  const sqrtN = Math.ceil(Math.sqrt(n));

  let ringIndex = 1;
  let placed = 1;
  while (placed < sorted.length) {
    const ringFraction = ringIndex / sqrtN;
    const baseRadius = maxRadius * ringFraction;
    // Enforce minimum gap between rings so they don't merge at high counts
    const radius = Math.max(baseRadius, ringIndex * minRingGap);
    const circumference = 2 * Math.PI * radius;
    const nodesInRing = Math.max(6, Math.floor(circumference / nodeSpacing));
    const count = Math.min(nodesInRing, sorted.length - placed);

    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / count + (ringIndex * 0.3); // offset each ring
      // Golden angle jitter for < 2000 nodes, skip for larger graphs
      const jitterR = n <= 2000
        ? radius * 0.04 * (Math.sin(placed * 137.508) * 0.5 + 0.5)
        : 0;
      const r = radius + jitterR;
      positions.set(sorted[placed].id, {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
      });
      placed++;
    }
    ringIndex++;
  }

  return positions;
}

// ─── Sigma Instance Manager ─────────────────────────────────────────────────

// ─── LOD Thresholds ─────────────────────────────────────────────────────────
// Camera ratio thresholds for Level-of-Detail filtering.
// Higher ratio = more zoomed out.
const LOD_FAR_RATIO = 3;       // very zoomed out: only hot nodes visible
const LOD_MID_RATIO = 1.5;     // medium zoom: moderate filtering
const LOD_FAR_HEAT = 0.4;      // min heat to show when very zoomed out
const LOD_MID_HEAT = 0.15;     // min heat to show at medium zoom
const LOD_DIM_ALPHA = 0.05;    // alpha for hidden-but-present nodes

// ─── Edge Caps ──────────────────────────────────────────────────────────────
const MAX_FALLBACK_EDGES = 2000;
const LARGE_GRAPH_THRESHOLD = 1000;

export default function WebGLGraph({ graphNodes, graphEdges, view, onSelectNode }: WebGLGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [, forceRender] = useState(0);

  // Zoom state for display — debounced to avoid 60fps re-renders during zoom
  const [zoomPercent, setZoomPercent] = useState(100);
  const zoomRafRef = useRef<number | null>(null);
  const zoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // LOD state — tracked outside React to avoid re-renders; Sigma reducers read it directly
  const cameraRatioRef = useRef(1);

  // Track current data to avoid full rebuild on every render
  const prevDataKey = useRef('');

  // Build graphology graph from our data
  const buildGraph = useCallback((nodes: GraphNode[], edges: GraphEdge[], w: number, h: number) => {
    const g = new Graph({ multi: false, type: 'undirected', allowSelfLoops: false });
    const positions = computeRingLayout(nodes, w, h);

    // Node lookup for fast edge validation
    const nodeSet = new Set(nodes.map(n => n.id));

    for (const node of nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const heat = node.heat ?? 0.5;
      const color = nodeColor(node.memory_type);
      const size = 3 + heat * 8; // 3–11px

      g.addNode(node.id, {
        x: pos.x,
        y: pos.y,
        size,
        color,
        label: node.label?.slice(0, 40) || node.id.slice(0, 8),
        type: 'circle',
        // Store metadata for hover/click
        _memoryType: node.memory_type,
        _heat: heat,
        _namespace: node.namespace || 'default',
        _fullLabel: node.label,
        // Border for hot nodes
        borderColor: heat > 0.7 ? color : undefined,
        borderSize: heat > 0.7 ? 1.5 : 0,
      });
    }

    // Cap edges for large graphs to prevent GPU/CPU overload
    let edgeCount = 0;
    const edgeLimit = nodes.length > LARGE_GRAPH_THRESHOLD ? MAX_FALLBACK_EDGES : Infinity;

    for (const edge of edges) {
      if (edgeCount >= edgeLimit) break;
      if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) continue;
      if (edge.source === edge.target) continue;
      const edgeKey = [edge.source, edge.target].sort().join('--');
      if (g.hasEdge(edgeKey)) continue;
      try {
        g.addEdgeWithKey(edgeKey, edge.source, edge.target, {
          weight: edge.weight || 0.3,
          size: 0.3 + (edge.weight || 0.3) * 1.2,
          color: `rgba(212, 175, 55, ${0.08 + (edge.weight || 0.3) * 0.15})`,
        });
        edgeCount++;
      } catch {
        // Edge already exists or invalid — skip silently
      }
    }

    return g;
  }, []);

  // Initialize or update sigma
  const initSigma = useCallback((container: HTMLDivElement) => {
    // Compute data key to detect real changes
    const dataKey = `${graphNodes.length}-${graphEdges.length}-${graphNodes[0]?.id || ''}`;
    if (dataKey === prevDataKey.current && sigmaRef.current) {
      return; // No change — skip rebuild
    }
    prevDataKey.current = dataKey;

    // Tear down existing instance
    if (sigmaRef.current) {
      sigmaRef.current.kill();
      sigmaRef.current = null;
    }
    if (graphRef.current) {
      graphRef.current.clear();
      graphRef.current = null;
    }

    const rect = container.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 600;

    const graph = buildGraph(graphNodes, graphEdges, w, h);
    graphRef.current = graph;

    // Custom label renderer: dark pill with black text, larger font, generous padding
    const drawDarkLabel = (
      ctx: CanvasRenderingContext2D,
      data: { label: string | null; size: number; x: number; y: number; color: string },
      settings: { labelFont: string; labelSize: number; labelWeight: string },
    ) => {
      if (!data.label) return;
      const fontSize = settings.labelSize;
      const font = `${settings.labelWeight} ${fontSize}px ${settings.labelFont}`;
      ctx.font = font;
      const text = data.label;
      const tw = ctx.measureText(text).width;
      const px = 8;   // horizontal padding
      const py = 5;   // vertical padding
      const gap = 6;  // space between node and label
      const x = data.x + data.size + gap;
      const y = data.y;
      const bx = x - px;
      const by = y - fontSize / 2 - py;
      const bw = tw + px * 2;
      const bh = fontSize + py * 2;
      const br = 4;   // border radius

      // Background pill
      ctx.fillStyle = '#D4AF37';
      ctx.beginPath();
      ctx.moveTo(bx + br, by);
      ctx.lineTo(bx + bw - br, by);
      ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
      ctx.lineTo(bx + bw, by + bh - br);
      ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
      ctx.lineTo(bx + br, by + bh);
      ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
      ctx.lineTo(bx, by + br);
      ctx.quadraticCurveTo(bx, by, bx + br, by);
      ctx.closePath();
      ctx.fill();

      // Text — black on gold
      ctx.fillStyle = '#050a0f';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y);
    };

    const sigma = new Sigma(graph, container, {
      // Rendering
      renderLabels: true, // Labels shown via nodeReducer on hover
      renderEdgeLabels: false,
      labelRenderedSizeThreshold: 999, // effectively disable auto labels
      defaultDrawNodeLabel: drawDarkLabel,
      // Performance
      enableEdgeEvents: false,
      // Appearance
      defaultNodeColor: '#555',
      defaultEdgeColor: 'rgba(212, 175, 55, 0.08)',
      defaultEdgeType: 'line',
      labelFont: '"SF Mono", "Fira Code", monospace',
      labelSize: 13,
      labelWeight: '600',
      labelColor: { color: '#050a0f' },
      stagePadding: 40,
      // Interactions
      minCameraRatio: 0.01,   // Allow extreme zoom out
      maxCameraRatio: 10,      // Allow extreme zoom in
    });

    // ─── Interaction State ────────────────────────────────
    let hoveredNode: string | null = null;
    let selectedNode: string | null = null;

    // Build heat lookup for LOD filtering (avoid repeated getNodeAttribute calls)
    const nodeHeatMap = new Map<string, number>();
    graph.forEachNode((id, attrs) => {
      nodeHeatMap.set(id, attrs._heat ?? 0.5);
    });
    let resonanceFrame: number | null = null;
    let resonanceGen = 0;             // generation counter — stale ticks self-terminate
    let resonanceAnimating = false;
    const RESONANCE_DEPTH = 3;
    const RESONANCE_DELAY = 200;
    const RESONANCE_FADE = 500;
    const RESONANCE_TOTAL = RESONANCE_DEPTH * RESONANCE_DELAY + RESONANCE_FADE;
    const RESONANCE_GLOW = '#FFFFFF';

    // Cancel any running animation cleanly
    function cancelResonance() {
      if (resonanceFrame !== null) {
        cancelAnimationFrame(resonanceFrame);
        resonanceFrame = null;
      }
      resonanceGen++;
      resonanceAnimating = false;
    }

    // ─── LOD helpers ───────────────────────────────────────
    // Returns the minimum heat threshold for the current camera ratio.
    // Nodes below this heat are dimmed (not removed) to preserve shape.
    function lodHeatThreshold(): number {
      const ratio = cameraRatioRef.current;
      if (ratio > LOD_FAR_RATIO) return LOD_FAR_HEAT;
      if (ratio > LOD_MID_RATIO) return LOD_MID_HEAT;
      return 0; // zoomed in — show everything
    }

    function isNodeVisibleByLod(nodeId: string): boolean {
      const heat = nodeHeatMap.get(nodeId) ?? 0.5;
      return heat >= lodHeatThreshold();
    }

    function shouldShowLabels(): boolean {
      return cameraRatioRef.current <= LOD_FAR_RATIO;
    }

    // Apply LOD dimming to a node result. Returns modified data.
    function applyLodDim(n: string, data: Record<string, any>): Record<string, any> {
      if (!isNodeVisibleByLod(n)) {
        const c = String(data.color || '#555');
        const dimColor = c.startsWith('#') && c.length <= 7
          ? `${c}${Math.round(LOD_DIM_ALPHA * 255).toString(16).padStart(2, '0')}`
          : `rgba(85,85,85,${LOD_DIM_ALPHA})`;
        return { ...data, color: dimColor, label: '', zIndex: 0 };
      }
      return data;
    }

    // Unified refresh — sets reducers based on current state + LOD
    function applyReducers() {
      if (hoveredNode) {
        // Hover ALWAYS takes priority — even during animation
        const neighbors = new Set(graph.neighbors(hoveredNode));
        neighbors.add(hoveredNode);

        sigma.setSetting('nodeReducer', (n, data) => {
          const res = { ...data };
          if (!neighbors.has(n)) {
            // Apply LOD dimming for non-neighbors
            const lodDimmed = applyLodDim(n, res);
            if (lodDimmed !== res) return lodDimmed;
            const c = String(data.color || '#555');
            res.color = c.startsWith('#') && c.length <= 7 ? `${c}33` : 'rgba(85,85,85,0.2)';
            res.label = '';
          } else {
            res.label = shouldShowLabels() ? (data.label || '') : '';
            if (n === hoveredNode) {
              res.highlighted = true;
              const full = graph.getNodeAttribute(n, '_fullLabel');
              res.label = full ? String(full).slice(0, 60) : (data.label || '');
            }
          }
          return res;
        });

        sigma.setSetting('edgeReducer', (edge, data) => {
          const [src, tgt] = graph.extremities(edge);
          if (!neighbors.has(src) || !neighbors.has(tgt)) {
            return { ...data, hidden: true };
          }
          return { ...data, color: 'rgba(212, 175, 55, 0.4)', size: data.size * 1.5 };
        });
      } else if (selectedNode) {
        // Static selected state (post-animation or no animation)
        const selAttrs = graph.getNodeAttributes(selectedNode);
        sigma.setSetting('nodeReducer', (n, data) => {
          if (n === selectedNode) {
            return {
              ...data,
              highlighted: true,
              label: (selAttrs._fullLabel || data.label || '').slice(0, 60),
              borderColor: '#ffffff',
              borderSize: 2,
            };
          }
          return applyLodDim(n, data);
        });
        sigma.setSetting('edgeReducer', (edge, data) => {
          const [src, tgt] = graph.extremities(edge);
          if (!isNodeVisibleByLod(src) && !isNodeVisibleByLod(tgt)) {
            return { ...data, hidden: true };
          }
          return data;
        });
      } else {
        // No selection — apply pure LOD filtering
        const threshold = lodHeatThreshold();
        if (threshold > 0) {
          sigma.setSetting('nodeReducer', (n, data) => applyLodDim(n, data));
          sigma.setSetting('edgeReducer', (edge, data) => {
            const [src, tgt] = graph.extremities(edge);
            if (!isNodeVisibleByLod(src) && !isNodeVisibleByLod(tgt)) {
              return { ...data, hidden: true };
            }
            return data;
          });
        } else {
          sigma.setSetting('nodeReducer', null);
          sigma.setSetting('edgeReducer', null);
        }
      }

      sigma.refresh();
    }

    // ─── Hover ────────────────────────────────────────────
    sigma.on('enterNode', ({ node }) => {
      hoveredNode = node;
      applyReducers();
    });

    sigma.on('leaveNode', () => {
      hoveredNode = null;
      // If animation is running, let it resume control; otherwise apply static state
      if (!resonanceAnimating) applyReducers();
      else sigma.refresh(); // just clear hover overlay, animation tick will set reducers next frame
    });

    // ─── Resonance Animation ──────────────────────────────
    function runResonanceAnimation(sourceNode: string) {
      cancelResonance();

      const layers = computeBfsLayers(graph, sourceNode, RESONANCE_DEPTH);
      const startTime = performance.now();
      const gen = ++resonanceGen;
      resonanceAnimating = true;

      function tick() {
        // Stale generation — another animation started or was cancelled
        if (gen !== resonanceGen) return;

        // If user is hovering, skip animation frame but keep it alive
        if (hoveredNode) {
          resonanceFrame = requestAnimationFrame(tick);
          return;
        }

        const elapsed = performance.now() - startTime;
        if (elapsed > RESONANCE_TOTAL) {
          // Done — hand off to unified reducer
          resonanceAnimating = false;
          resonanceFrame = null;
          applyReducers();
          return;
        }

        // Color-only pulse
        sigma.setSetting('nodeReducer', (n, data) => {
          const res = { ...data };
          const layer = layers.get(n);

          if (layer === undefined) {
            const c = String(data.color || '#555');
            res.color = c.startsWith('#') && c.length <= 7 ? `${c}33` : 'rgba(85,85,85,0.2)';
            res.label = '';
            return res;
          }

          const layerActivation = layer * RESONANCE_DELAY;
          const timeSinceActivation = elapsed - layerActivation;

          if (timeSinceActivation < 0) {
            const c = String(data.color || '#555');
            res.color = c.startsWith('#') && c.length <= 7 ? `${c}44` : 'rgba(85,85,85,0.25)';
            res.label = '';
            return res;
          }

          const glowProgress = Math.min(timeSinceActivation / RESONANCE_FADE, 1);
          const glowIntensity = 1 - easeOutCubic(glowProgress);
          const damping = Math.pow(0.7, layer);
          const intensity = glowIntensity * damping;

          const baseColor = String(data.color || '#555');
          if (intensity > 0.01 && baseColor.startsWith('#') && baseColor.length <= 7) {
            res.color = lerpColor(baseColor, RESONANCE_GLOW, intensity);
          }

          if (n === sourceNode) {
            res.highlighted = true;
            const full = graph.getNodeAttribute(n, '_fullLabel');
            res.label = full ? String(full).slice(0, 60) : (data.label || '');
            res.borderColor = '#ffffff';
            res.borderSize = 2;
          } else {
            res.label = '';
          }

          return res;
        });

        sigma.setSetting('edgeReducer', (edge, data) => {
          const [src, tgt] = graph.extremities(edge);
          const srcLayer = layers.get(src);
          const tgtLayer = layers.get(tgt);

          if (srcLayer === undefined || tgtLayer === undefined) {
            return { ...data, hidden: true };
          }

          const maxLayer = Math.max(srcLayer, tgtLayer);
          const timeSinceActivation = elapsed - maxLayer * RESONANCE_DELAY;
          if (timeSinceActivation < 0) return { ...data, hidden: true };

          const glowProgress = Math.min(timeSinceActivation / RESONANCE_FADE, 1);
          const glowIntensity = (1 - easeOutCubic(glowProgress)) * Math.pow(0.7, maxLayer);
          const alpha = 0.08 + glowIntensity * 0.5;
          return { ...data, color: `rgba(212, 175, 55, ${alpha.toFixed(2)})` };
        });

        sigma.refresh();
        resonanceFrame = requestAnimationFrame(tick);
      }

      resonanceFrame = requestAnimationFrame(tick);
    }

    // ─── Click: select + resonance ────────────────────────
    sigma.on('clickNode', ({ node }) => {
      selectedNode = node;
      selectedIdRef.current = node;
      const attrs = graph.getNodeAttributes(node);
      onSelectNode({
        id: node,
        label: attrs._fullLabel || attrs.label || '',
        memory_type: attrs._memoryType || '',
        heat: attrs._heat ?? 0.5,
        namespace: attrs._namespace || 'default',
      });
      runResonanceAnimation(node);
    });

    sigma.on('clickStage', () => {
      if (hoveredNode) return;
      cancelResonance();
      selectedNode = null;
      selectedIdRef.current = null;
      onSelectNode(null);
      applyReducers();
    });

    // Track zoom for display — debounced to prevent 60fps React re-renders
    sigma.getCamera().on('updated', (state) => {
      // Always update the ratio ref synchronously for LOD (no React render needed)
      cameraRatioRef.current = state.ratio;

      // Debounce the React state update for the zoom% display
      if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
      zoomDebounceRef.current = setTimeout(() => {
        setZoomPercent(Math.round((1 / state.ratio) * 100));
      }, 200);

      // Use rAF to apply LOD reducers at screen refresh rate (not 60 setState/s)
      if (zoomRafRef.current === null) {
        zoomRafRef.current = requestAnimationFrame(() => {
          zoomRafRef.current = null;
          // Re-apply LOD reducers based on new camera ratio
          if (!resonanceAnimating) applyReducers();
        });
      }
    });

    sigmaRef.current = sigma;
  }, [graphNodes, graphEdges, buildGraph, onSelectNode]);

  // Ref callback — mounts sigma when container appears
  const containerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;

    if (!el) {
      // Cleanup on unmount
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
      if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
      if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current);
      return;
    }

    // Slight delay to ensure container has dimensions
    requestAnimationFrame(() => {
      if (containerRef.current && graphNodes.length > 0) {
        initSigma(containerRef.current);
      }
    });
  }, [initSigma, graphNodes.length]);

  // Reinitialize when data changes (new nodes/edges)
  // Triggered by ref comparison in initSigma — it skips if dataKey matches
  if (containerRef.current && graphNodes.length > 0) {
    const dataKey = `${graphNodes.length}-${graphEdges.length}-${graphNodes[0]?.id || ''}`;
    if (dataKey !== prevDataKey.current) {
      requestAnimationFrame(() => {
        if (containerRef.current) initSigma(containerRef.current);
      });
    }
  }

  // ─── Legend ──────────────────────────────────────────────

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    graphNodes.forEach(n => { counts[n.memory_type] = (counts[n.memory_type] || 0) + 1; });
    return counts;
  }, [graphNodes]);

  const nsLegend = useMemo(() => {
    const counts: Record<string, number> = {};
    graphNodes.forEach(n => { const ns = n.namespace || 'default'; counts[ns] = (counts[ns] || 0) + 1; });
    return Object.keys(counts).sort().map((ns, i) => ({
      ns,
      count: counts[ns],
      color: NS_COLORS[i % NS_COLORS.length],
    }));
  }, [graphNodes]);

  // ─── Zoom controls ──────────────────────────────────────

  const zoomIn = useCallback(() => {
    const camera = sigmaRef.current?.getCamera();
    if (camera) camera.animatedZoom({ duration: 200 });
  }, []);

  const zoomOut = useCallback(() => {
    const camera = sigmaRef.current?.getCamera();
    if (camera) camera.animatedUnzoom({ duration: 200 });
  }, []);

  const zoomReset = useCallback(() => {
    const camera = sigmaRef.current?.getCamera();
    if (camera) camera.animatedReset({ duration: 300 });
  }, []);

  // ─── Dynamic height ─────────────────────────────────────

  const graphH = Math.max(700, Math.min(2400, 400 + graphNodes.length * 3));
  const containerHeight = view === 'graph' ? graphH : Math.max(420, Math.min(900, 300 + graphNodes.length * 0.5));

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="w-full bg-[#050a0f] border border-[#D4AF37]/20 relative overflow-hidden rounded-sm" style={{ minHeight: containerHeight }}>
      {/* Legend */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 text-[10px] tracking-widest uppercase bg-[#050a0f]/90 backdrop-blur-sm px-3 py-2 border border-[#D4AF37]/15 rounded-sm pointer-events-none">
        <div className="flex flex-wrap gap-3">
          {Object.entries(typeCounts).map(([type, count]) => (
            <span key={type} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: nodeColor(type) }} />
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
        <button onClick={zoomIn} className="text-[#555] hover:text-[#D4AF37] text-xs font-mono px-1">+</button>
        <span className="text-[10px] text-[#555] font-mono w-10 text-center">{zoomPercent}%</span>
        <button onClick={zoomOut} className="text-[#555] hover:text-[#D4AF37] text-xs font-mono px-1">−</button>
        <button onClick={zoomReset} className="text-[10px] text-[#555] hover:text-[#00F0FF] uppercase tracking-wider ml-1">Reset</button>
      </div>

      {/* Node count badge */}
      <div className="absolute top-3 right-3 z-10 text-[10px] text-[#555] font-mono tracking-wider bg-[#050a0f]/90 backdrop-blur-sm px-2 py-1 border border-[#D4AF37]/15 rounded-sm pointer-events-none">
        {graphNodes.length.toLocaleString()} nodes · {graphEdges.length.toLocaleString()} edges
      </div>

      {graphNodes.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-[#555] animate-pulse tracking-widest text-sm uppercase">
          <TbAtom size={20} className="mr-2 animate-pulse" /> Loading graph…
        </div>
      ) : (
        <div
          ref={containerCallbackRef}
          style={{ width: '100%', height: containerHeight, background: '#050a0f' }}
        />
      )}
    </div>
  );
}
