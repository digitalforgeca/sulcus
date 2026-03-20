'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SiteNav } from '@/components/site-nav';

/* ── Thermodynamic Lifecycle Diagram ──────────────────────────────
   Interactive Canvas diagram showing how memory flows through the
   Sulcus thermodynamic engine. Nodes represent states, edges show
   transitions. Heat pulses visually.
   ──────────────────────────────────────────────────────────────── */

interface LifecycleNode {
  id: string;
  label: string;
  sublabel: string;
  x: number;
  y: number;
  color: [number, number, number];
  heat: number;      // animated 0–1
  heatTarget: number;
  radius: number;
}

interface LifecycleEdge {
  from: string;
  to: string;
  label: string;
  color: [number, number, number];
  pulse: number; // animated 0–1
  pulseSpeed: number;
}

const CYAN: [number, number, number] = [0, 240, 255];
const GOLD: [number, number, number] = [212, 175, 55];
const ORANGE: [number, number, number] = [255, 107, 53];
const RED: [number, number, number] = [239, 68, 68];
const GREEN: [number, number, number] = [34, 197, 94];
const BLUE: [number, number, number] = [59, 130, 246];
const PURPLE: [number, number, number] = [168, 85, 247];

function ThermodynamicDiagram({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<LifecycleNode[]>([]);
  const edgesRef = useRef<LifecycleEdge[]>([]);
  const timeRef = useRef(0);
  const frameRef = useRef(0);

  useEffect(() => {
    if (width < 10 || height < 10) return;

    // Layout nodes in a flow: left-to-right with a feedback loop
    const cx = width / 2;
    const cy = height / 2;
    const xSpread = Math.min(width * 0.38, 320);
    const ySpread = Math.min(height * 0.32, 140);

    nodesRef.current = [
      { id: 'record',      label: 'RECORD',       sublabel: 'Memory Created',      x: cx - xSpread,         y: cy - ySpread * 0.3,  color: GREEN,  heat: 1.0, heatTarget: 1.0, radius: 28 },
      { id: 'ignite',      label: 'IGNITE',       sublabel: 'Heat = 1.0',          x: cx - xSpread * 0.45,  y: cy - ySpread,        color: ORANGE, heat: 0.9, heatTarget: 0.95, radius: 26 },
      { id: 'active',      label: 'ACTIVE INDEX', sublabel: 'In Context Window',   x: cx + xSpread * 0.1,   y: cy - ySpread * 0.85, color: CYAN,   heat: 0.8, heatTarget: 0.85, radius: 30 },
      { id: 'decay',       label: 'DECAY',        sublabel: 'Heat Cools Over Time', x: cx + xSpread * 0.65,  y: cy - ySpread * 0.2,  color: BLUE,   heat: 0.4, heatTarget: 0.5, radius: 24 },
      { id: 'recall',      label: 'RECALL',       sublabel: 'Searched / Retrieved', x: cx + xSpread * 0.15,  y: cy + ySpread * 0.6,  color: GOLD,   heat: 0.7, heatTarget: 0.8, radius: 28 },
      { id: 'reinforce',   label: 'REINFORCE',    sublabel: 'Stability Grows',     x: cx - xSpread * 0.45,  y: cy + ySpread * 0.8,  color: PURPLE, heat: 0.6, heatTarget: 0.7, radius: 24 },
      { id: 'consolidate', label: 'FOLD',         sublabel: 'Cold Nodes Merge',    x: cx + xSpread,         y: cy + ySpread * 0.4,  color: RED,    heat: 0.15, heatTarget: 0.2, radius: 22 },
    ];

    edgesRef.current = [
      { from: 'record',    to: 'ignite',      label: 'heat = 1.0',         color: GREEN,  pulse: 0, pulseSpeed: 0.008 },
      { from: 'ignite',    to: 'active',      label: 'hot threshold',      color: ORANGE, pulse: 0, pulseSpeed: 0.006 },
      { from: 'active',    to: 'decay',       label: 'time passes',        color: CYAN,   pulse: 0, pulseSpeed: 0.005 },
      { from: 'decay',     to: 'consolidate', label: 'below cold line',    color: BLUE,   pulse: 0, pulseSpeed: 0.004 },
      { from: 'decay',     to: 'recall',      label: 'agent searches',     color: GOLD,   pulse: 0, pulseSpeed: 0.007 },
      { from: 'recall',    to: 'reinforce',   label: 'stability x gain',   color: GOLD,   pulse: 0, pulseSpeed: 0.006 },
      { from: 'reinforce', to: 'active',      label: 're-enter context',   color: PURPLE, pulse: 0, pulseSpeed: 0.005 },
      { from: 'consolidate', to: 'active',    label: 'dense summary',      color: RED,    pulse: 0, pulseSpeed: 0.003 },
    ];

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    function getNode(id: string): LifecycleNode | undefined {
      return nodesRef.current.find(n => n.id === id);
    }

    function drawArrow(
      ctx: CanvasRenderingContext2D,
      x1: number, y1: number, x2: number, y2: number,
      color: [number, number, number], alpha: number, pulse: number,
      label: string, fromR: number, toR: number
    ) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) return;
      const nx = dx / dist;
      const ny = dy / dist;

      // Start/end offset by radius
      const sx = x1 + nx * (fromR + 4);
      const sy = y1 + ny * (fromR + 4);
      const ex = x2 - nx * (toR + 10);
      const ey = y2 - ny * (toR + 10);

      // Curved path via control point (slight bend)
      const mx = (sx + ex) / 2 - ny * 20;
      const my = (sy + ey) / 2 + nx * 20;

      // Edge line
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.15 + alpha * 0.25})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Arrowhead
      const angle = Math.atan2(ey - my, ex - mx);
      const aLen = 8;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - aLen * Math.cos(angle - 0.35), ey - aLen * Math.sin(angle - 0.35));
      ctx.lineTo(ex - aLen * Math.cos(angle + 0.35), ey - aLen * Math.sin(angle + 0.35));
      ctx.closePath();
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.3 + alpha * 0.5})`;
      ctx.fill();

      // Pulse dot traveling along the edge
      const t = pulse;
      const pt = 1 - t;
      const px = pt * pt * sx + 2 * pt * t * mx + t * t * ex;
      const py = pt * pt * sy + 2 * pt * t * my + t * t * ey;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.6 + alpha * 0.4})`;
      ctx.shadowColor = `rgba(${color[0]},${color[1]},${color[2]},0.8)`;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Edge label
      const lx = (sx + ex) / 2 - ny * 12;
      const ly = (sy + ey) / 2 + nx * 12;
      ctx.font = '9px monospace';
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.3 + alpha * 0.3})`;
      ctx.textAlign = 'center';
      ctx.fillText(label, lx, ly);
    }

    function drawNode(ctx: CanvasRenderingContext2D, node: LifecycleNode, t: number) {
      const { x, y, color, heat, radius, label, sublabel } = node;
      const pulse = 0.85 + 0.15 * Math.sin(t * 2 + node.x * 0.01);

      // Glow
      const glowR = radius + 12 + heat * 8;
      const grad = ctx.createRadialGradient(x, y, radius * 0.5, x, y, glowR);
      grad.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${heat * 0.25 * pulse})`);
      grad.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
      ctx.beginPath();
      ctx.arc(x, y, glowR, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Ring
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.3 + heat * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Inner fill
      ctx.beginPath();
      ctx.arc(x, y, radius - 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.04 + heat * 0.08})`;
      ctx.fill();

      // Heat arc (partial ring showing heat level)
      if (heat > 0.01) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * heat);
        ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.4 + heat * 0.4})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label
      ctx.font = 'bold 10px -apple-system, sans-serif';
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.7 + heat * 0.3})`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x, y + 2);

      // Sublabel
      ctx.font = '8px monospace';
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},0.35)`;
      ctx.fillText(sublabel, x, y + radius + 16);
    }

    function animate() {
      if (!running) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      timeRef.current += 0.016;
      const t = timeRef.current;

      ctx.clearRect(0, 0, width, height);

      // Background grid
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.02)';
      ctx.lineWidth = 0.5;
      const gridSize = 40;
      for (let gx = 0; gx < width; gx += gridSize) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, height); ctx.stroke();
      }
      for (let gy = 0; gy < height; gy += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(width, gy); ctx.stroke();
      }

      // Animate node heat (gentle oscillation toward target)
      for (const node of nodesRef.current) {
        const wobble = Math.sin(t * 1.5 + node.x * 0.005 + node.y * 0.003) * 0.08;
        node.heat += (node.heatTarget + wobble - node.heat) * 0.02;
      }

      // Animate edge pulses
      for (const edge of edgesRef.current) {
        edge.pulse = (edge.pulse + edge.pulseSpeed) % 1.0;
      }

      // Draw edges
      for (const edge of edgesRef.current) {
        const from = getNode(edge.from);
        const to = getNode(edge.to);
        if (!from || !to) continue;
        const alpha = (from.heat + to.heat) / 2;
        drawArrow(ctx, from.x, from.y, to.x, to.y, edge.color, alpha, edge.pulse, edge.label, from.radius, to.radius);
      }

      // Draw nodes
      for (const node of nodesRef.current) {
        drawNode(ctx, node, t);
      }

      // Title in diagram
      ctx.font = '9px monospace';
      ctx.fillStyle = 'rgba(0, 240, 255, 0.2)';
      ctx.textAlign = 'center';
      ctx.fillText('THERMODYNAMIC LIFECYCLE', width / 2, height - 12);

      frameRef.current = requestAnimationFrame(animate);
    }

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="block w-full h-full"
    />
  );
}

export default function Home() {
  const [email, setEmail] = useState('');
  const [joined, setJoined] = useState(false);
  const [vizSize, setVizSize] = useState({ w: 700, h: 400 });
  const vizContainerRef = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    // Capture email to waitlist before redirecting
    try {
      await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'landing' }),
      });
    } catch {
      // Don't block registration if waitlist capture fails
    }
    setJoined(true);
    setTimeout(() => {
      window.location.href = '/login';
    }, 1500);
  }, [email]);

  useEffect(() => {
    const el = vizContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setVizSize({ w: Math.round(width), h: Math.max(Math.round(height), 320) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-[#050a0f] text-white font-mono overflow-hidden relative">
      {/* Decorative top bar */}
      <div className="fixed top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent opacity-30 z-50"></div>
      
      <div className="max-w-6xl mx-auto px-4 md:px-8 relative z-10">
        <SiteNav />

        {/* Hero Section */}
        <header className="text-center py-24 md:py-32 relative">
          <div className="flex items-center justify-center mb-8 opacity-50">
            <div className="h-[1px] w-16 bg-gradient-to-l from-[#D4AF37] to-transparent"></div>
            <div className="w-2 h-2 rotate-45 bg-[#00F0FF] mx-4 shadow-[0_0_5px_#00F0FF]"></div>
            <div className="h-[1px] w-16 bg-gradient-to-r from-[#D4AF37] to-transparent"></div>
          </div>

          <h1 className="text-6xl md:text-8xl font-bold mb-4 tracking-tighter text-white uppercase" style={{ textShadow: '0 0 30px rgba(0, 240, 255, 0.3)' }}>
            SULCUS
          </h1>
          <p className="text-xl md:text-2xl text-[#D4AF37] mb-4 font-sans tracking-widest uppercase max-w-3xl mx-auto">
            Memory That Thinks.
          </p>
          <p className="text-sm text-[#00F0FF]/60 mb-8 font-mono tracking-wider uppercase">
            Thermodynamic vMMU for AI Agents
          </p>

          <p className="text-lg mb-12 max-w-2xl mx-auto text-cyan-50/70 font-sans leading-relaxed">
            Your agent forgets everything the moment its context window fills. Sulcus gives it a <span className="text-white font-semibold">real memory</span> — a thermodynamic graph that heats what matters, cools what doesn&apos;t, and pages the right context in at the right time.
          </p>
          
          <div className="flex flex-col md:flex-row justify-center items-center gap-4">
            <a href="/login" className="w-full md:w-auto bg-[#D4AF37] text-[#050a0f] px-10 py-4 font-bold hover:brightness-110 transition-all tracking-widest uppercase shadow-[0_0_20px_rgba(212,175,55,0.3)]">
              Start Building
            </a>
            <a href="/docs/sdks" className="w-full md:w-auto bg-transparent border border-[#888] text-white px-10 py-4 font-bold hover:border-white transition-all tracking-widest uppercase">
              View SDK
            </a>
          </div>
        </header>

        {/* The Thermodynamic Philosophy */}
        <section className="py-24 border-y border-[#D4AF37]/20 bg-[#0a1520]/30 relative">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-xs tracking-[0.5em] text-[#00F0FF] uppercase mb-4">The Philosophy</h2>
              <h3 className="text-3xl font-bold mb-6 text-white uppercase tracking-tighter leading-tight">We didn&apos;t contort the LLM. We accelerated the system around it.</h3>
              <p className="text-[#888] font-sans leading-relaxed mb-6">
                Memories aren&apos;t static rows in a database. They&apos;re thermodynamic objects — born hot, cooling with time, reheating on recall, diffusing through edges to related knowledge. When an agent searches, the engine doesn&apos;t just find matches. It <em className="text-white not-italic">ignites</em> the graph.
              </p>
              <ul className="space-y-4 font-sans text-sm">
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 bg-[#22c55e] mt-1.5 shrink-0 shadow-[0_0_5px_#22c55e]"></div>
                  <span><strong className="text-white">Record</strong> — every memory enters the graph at heat 1.0</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 bg-[#FF6B35] mt-1.5 shrink-0 shadow-[0_0_5px_#FF6B35]"></div>
                  <span><strong className="text-white">Decay</strong> — type-specific half-lives cool memories naturally (24h for episodes, 365d for facts)</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 bg-[#D4AF37] mt-1.5 shrink-0 shadow-[0_0_5px_#D4AF37]"></div>
                  <span><strong className="text-white">Recall</strong> — searching boosts heat and stability. Spaced repetition makes memories stickier</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 bg-[#a855f7] mt-1.5 shrink-0 shadow-[0_0_5px_#a855f7]"></div>
                  <span><strong className="text-white">Diffuse</strong> — heat spreads through edges to related memories. Recall one, warm many</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 bg-[#ef4444] mt-1.5 shrink-0 shadow-[0_0_5px_#ef4444]"></div>
                  <span><strong className="text-white">Fold</strong> — cold memories consolidate into dense semantic summaries. Nothing is lost</span>
                </li>
              </ul>
            </div>
            
            <div ref={vizContainerRef} className="relative border border-[#D4AF37]/20 bg-[#050a0f] shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-hidden" style={{ minHeight: '380px' }}>
              <div className="absolute -top-3 -left-3 w-6 h-6 border-t-2 border-l-2 border-[#D4AF37] z-10"></div>
              <div className="absolute -bottom-3 -right-3 w-6 h-6 border-b-2 border-r-2 border-[#D4AF37] z-10"></div>
              
              <div className="absolute inset-0">
                <ThermodynamicDiagram width={vizSize.w} height={vizSize.h} />
              </div>
            </div>
          </div>
        </section>

        {/* Feature Grid: The SULCUS Stack */}
        <section className="py-24">
          <div className="text-center mb-20">
            <h2 className="text-3xl font-bold mb-4 text-white uppercase tracking-widest">Autonomous Memory Ecosystem</h2>
            <p className="text-[#888] max-w-xl mx-auto font-sans">Three specialized components for persistent, local-first recall.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {[
              {
                id: "01",
                title: "WASM Memory Core",
                color: "#00F0FF",
                desc: "The thermodynamic engine compiled to WebAssembly. Runs in your agent's process, in the browser, or on the edge. Sub-millisecond reads. Zero network calls. Your data never leaves the machine."
              },
              {
                id: "02",
                title: "MCP Sidecar",
                color: "#D4AF37",
                desc: "A native Rust process that sits between your agent and its LLM. It intercepts context, injects relevant memories, and pages out stale turns automatically. Works with any MCP-compatible host."
              },
              {
                id: "03",
                title: "Cloud Sync",
                color: "#FF6B35",
                desc: "CRDT-based replication across agents, machines, and teams. Every agent maintains a local graph; the cloud merges them into a shared knowledge mesh. Conflict-free by design."
              }
            ].map((f) => (
              <div key={f.id} className="flex flex-col p-8 border border-[#222] hover:border-[#D4AF37]/50 transition-all duration-500 bg-[#0a1520]/20 group">
                <div className="flex items-center gap-4 mb-6">
                  <span className="text-2xl font-bold opacity-20 group-hover:opacity-100 transition-opacity" style={{ color: f.color }}>{f.id}</span>
                  <h3 className="text-xl font-bold tracking-widest uppercase text-white">{f.title}</h3>
                </div>
                <p className="text-sm text-[#888] font-sans leading-relaxed mb-8 flex-1">
                  {f.desc}
                </p>
                <div className="h-1 w-8 transition-all duration-500 group-hover:w-full" style={{ backgroundColor: f.color }}></div>
              </div>
            ))}
          </div>
        </section>

        {/* The 30 Knobs */}
        <section className="py-24 border-t border-[#D4AF37]/20">
          <div className="text-center mb-16">
            <h2 className="text-xs tracking-[0.5em] text-[#00F0FF] uppercase mb-4">Full Control</h2>
            <p className="text-2xl font-bold text-white uppercase tracking-tight mb-4">30+ Configurable Knobs. Zero Hardcoded Behavior.</p>
            <p className="text-[#888] max-w-xl mx-auto font-sans text-sm">
              Every parameter of the thermodynamic engine is exposed via API. Tune decay profiles, resonance depth, consolidation thresholds, and context budgets per tenant, per type, per node.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Active Index', knobs: ['max_nodes', 'context_budget', 'hot_threshold', 'cold_threshold'], color: CYAN },
              { label: 'Resonance', knobs: ['spread_factor', 'depth', 'damping', 'thermal_gate'], color: PURPLE },
              { label: 'Reinforcement', knobs: ['on_recall', 'on_update', 'on_edge', 'stability_gain'], color: GOLD },
              { label: 'Consolidation', knobs: ['cold_trigger', 'cold_threshold', 'strategy'], color: RED },
              { label: 'Tick Mode', knobs: ['interval_ms', 'trigger_ops', 'max_idle_ms'], color: GREEN },
              { label: 'Decay Profiles', knobs: ['half_life', 'floor', 'reinforce', 'stab_gain'], color: ORANGE },
            ].map((group) => (
              <div key={group.label} className="border border-[#1a2a3a] p-4 bg-[#0a1520]/20">
                <div className="text-[10px] tracking-[0.3em] uppercase mb-3 font-bold" style={{ color: `rgb(${group.color.join(',')})` }}>{group.label}</div>
                {group.knobs.map(k => (
                  <div key={k} className="text-[10px] text-[#555] font-mono mb-1 flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full" style={{ backgroundColor: `rgb(${group.color.join(',')})`, opacity: 0.4 }}></span>
                    {k}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* Reactive Triggers */}
        <section className="py-24 bg-[#050a0f] border-t border-[#FF6B35]/20 relative overflow-hidden">
          <div className="max-w-5xl mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-xs tracking-[0.5em] text-[#FF6B35] uppercase mb-4">No Competitor Has This</h2>
              <p className="text-2xl font-bold text-white uppercase tracking-tight mb-4">Reactive Memory Triggers</p>
              <p className="text-[#888] max-w-2xl mx-auto font-sans text-sm">
                Set rules on your memory graph. When events happen — a memory is stored, recalled, boosted, or starts to decay — Sulcus fires actions automatically. Pin important memories. Boost fading context. Webhook your systems. The agent doesn&apos;t have to remember to remember.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
              {[
                { event: "on_store", action: "pin", desc: "Auto-pin every preference memory so it never decays.", color: "#D4AF37" },
                { event: "on_recall", action: "boost", desc: "Reinforce memories every time they're searched — spaced repetition, automated.", color: "#00F0FF" },
                { event: "on_decay", action: "notify", desc: "Alert the agent when critical knowledge starts cooling. Act before it's lost.", color: "#FF6B35" },
                { event: "on_threshold", action: "webhook", desc: "Fire HTTP callbacks when memory heat crosses a boundary. Integrate anything.", color: "#9333EA" },
              ].map((t) => (
                <div key={t.event} className="border border-[#1a2a3a] p-6 bg-[#0a1520]/30 hover:border-[#FF6B35]/40 transition-all">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-[10px] px-2 py-0.5 rounded font-mono border" style={{ color: t.color, borderColor: `${t.color}40` }}>{t.event}</span>
                    <span className="text-[#555]">→</span>
                    <span className="text-[10px] px-2 py-0.5 rounded font-mono border border-[#333] text-[#aaa]">{t.action}</span>
                  </div>
                  <p className="text-sm text-[#888] font-sans leading-relaxed">{t.desc}</p>
                </div>
              ))}
            </div>

            <div className="text-center">
              <p className="text-[10px] tracking-[0.3em] uppercase text-[#555]">
                6 events · 7 actions · filter by type, namespace, label pattern, heat threshold · unlimited triggers per tenant
              </p>
            </div>
          </div>
        </section>

        {/* SDK Section */}
        <section className="py-24 bg-[#050a0f] border-t border-[#D4AF37]/20">
          <div className="max-w-4xl mx-auto px-4 text-center">
            <h2 className="text-xs tracking-[0.5em] text-[#D4AF37] uppercase mb-4">Developer-First</h2>
            <p className="text-2xl font-bold text-white uppercase tracking-tight mb-4">Five lines. Real memory.</p>
            <p className="text-[#888] max-w-xl mx-auto font-sans text-sm mb-12">
              Zero-dependency SDKs for Python and Node.js. Or connect directly via MCP or REST.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left mb-12">
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-[#D4AF37] text-sm font-bold tracking-widest uppercase">Python</span>
                  <code className="text-xs text-[#555] font-mono">pip install sulcus</code>
                </div>
                <pre className="bg-[#0a1018] border border-[#00F0FF]/10 p-4 text-xs font-mono text-[#ccc] overflow-x-auto leading-relaxed">
{`from sulcus import Sulcus

s = Sulcus(api_key="sk-...")
s.remember("User prefers dark mode",
           memory_type="preference")
results = s.search("dark mode")`}
                </pre>
              </div>
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-[#D4AF37] text-sm font-bold tracking-widest uppercase">Node.js</span>
                  <code className="text-xs text-[#555] font-mono">npm install sulcus</code>
                </div>
                <pre className="bg-[#0a1018] border border-[#00F0FF]/10 p-4 text-xs font-mono text-[#ccc] overflow-x-auto leading-relaxed">
{`import { Sulcus } from "sulcus";

const s = new Sulcus({ apiKey: "sk-..." });
await s.remember("User prefers dark mode",
  { memoryType: "preference" });
const results = await s.search("dark mode");`}
                </pre>
              </div>
            </div>

            <a href="/docs" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Full Documentation &rarr;
            </a>
          </div>
        </section>

        {/* Privacy-First Section */}
        <section className="py-24 bg-[#050a0f] border-t border-[#00F0FF]/10 relative overflow-hidden">
          <div className="max-w-4xl mx-auto relative z-10 px-4">
            <div className="text-center mb-16">
              <h2 className="text-xs tracking-[0.5em] text-[#00F0FF] uppercase mb-4">Privacy-First Architecture</h2>
              <p className="text-2xl font-bold text-white uppercase tracking-tight mb-4">Your memories. Your machine. Your rules.</p>
              <p className="text-[#888] max-w-2xl mx-auto font-sans text-sm">
                Most memory systems require your data to live on someone else&apos;s server.
                Sulcus runs locally by default. Cloud sync is optional, encrypted, and you control what leaves the machine.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
              {[
                {
                  title: "Local-First",
                  desc: "The WASM core and MCP sidecar run entirely on your hardware. No network calls required for reads or writes. Your agent's memory never touches a cloud server unless you explicitly enable sync.",
                  marker: "01"
                },
                {
                  title: "Zero Knowledge Sync",
                  desc: "When you do enable cloud sync, data is encrypted in transit (TLS 1.3) and at rest (AES-256). Tenant isolation ensures your memory graph is invisible to other users — and to us.",
                  marker: "02"
                },
                {
                  title: "Data Sovereignty",
                  desc: "Self-host the entire stack — server, database, sync — in your own infrastructure. No phone-home telemetry, no surprises. Enterprise licensing available for on-premise deployments.",
                  marker: "03"
                },
                {
                  title: "Selective Sync",
                  desc: "Choose which namespaces sync to the cloud and which stay local. Sensitive memories (credentials, personal data, health info) can remain on-device while shared knowledge replicates across your fleet.",
                  marker: "04"
                },
              ].map((item) => (
                <div key={item.title} className="p-6 border border-[#00F0FF]/10 hover:border-[#00F0FF]/30 transition-all bg-[#0a1520]/30">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-lg font-bold text-[#00F0FF]/30 font-mono">{item.marker}</span>
                    <h3 className="text-sm font-bold tracking-widest uppercase text-white">{item.title}</h3>
                  </div>
                  <p className="text-xs text-[#888] font-sans leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>

            <div className="text-center text-xs text-[#555] tracking-widest uppercase">
              GDPR-ready &middot; SOC2 roadmap &middot; No telemetry &middot; Enterprise on-premise available
            </div>
          </div>
        </section>

        {/* Trust & Performance Section */}
        <section className="py-24 bg-[#050a0f] border-t border-[#D4AF37]/20 relative overflow-hidden">
          <div className="max-w-3xl mx-auto text-center relative z-10">
            <h2 className="text-xs tracking-[0.5em] text-[#D4AF37] uppercase mb-8">Performance Validated</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-16">
              <div>
                <div className="text-4xl font-bold text-[#00F0FF] mb-2 font-mono">&lt;25ms</div>
                <div className="text-[10px] text-[#888] uppercase tracking-widest">Context Build Time</div>
              </div>
              <div>
                <div className="text-4xl font-bold text-[#00F0FF] mb-2 font-mono">Local</div>
                <div className="text-[10px] text-[#888] uppercase tracking-widest">Data Sovereignty</div>
              </div>
              <div>
                <div className="text-4xl font-bold text-[#00F0FF] mb-2 font-mono">30+</div>
                <div className="text-[10px] text-[#888] uppercase tracking-widest">Tunable Parameters</div>
              </div>
            </div>
            <a href="/docs" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors flex items-center justify-center gap-2">
              View Documentation <span>&rarr;</span>
            </a>
          </div>
        </section>

        {/* Final CTA / Registration */}
        <section className="py-32 text-center relative">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03]">
            <div className="w-[500px] h-[500px] rounded-full border border-[#00F0FF] animate-pulse"></div>
          </div>
          
          <h2 className="text-4xl font-bold mb-8 text-white uppercase tracking-tighter">Give Your Agents a Brain.</h2>
          <p className="text-lg mb-12 max-w-xl mx-auto text-[#888] font-sans">
            Free tier. No credit card. Start building agents with real memory in under five minutes.
          </p>

          {joined ? (
            <div className="bg-[#0a1520] border border-[#00F0FF] text-[#00F0FF] px-12 py-6 font-bold inline-block animate-pulse shadow-[0_0_30px_rgba(0,240,255,0.2)]">
              [ ACCESS GRANTED. REDIRECTING TO DASHBOARD... ]
            </div>
          ) : (
            <div className="max-w-md mx-auto">
              <form onSubmit={handleSubmit} className="flex mb-6">
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="YOUR EMAIL" 
                  className="flex-1 bg-[#0a1520] border border-[#D4AF37] border-r-0 px-6 py-4 focus:border-[#00F0FF] focus:outline-none transition-colors text-white placeholder-[#D4AF37]/40 text-sm uppercase tracking-wider"
                  required
                />
                <button
                  type="submit"
                  className="bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-[#050a0f] px-8 py-4 font-bold hover:brightness-125 transition-all whitespace-nowrap tracking-wider uppercase"
                >
                  Join Now
                </button>
              </form>
              <p className="text-xs text-[#555] tracking-widest uppercase">
                Privacy-first. Secure. Your data, your control.
              </p>
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="py-16 border-t border-[#D4AF37]/20 text-center">
          <div className="flex justify-center gap-8 mb-8 text-xs text-[#555] uppercase tracking-widest">
            <a href="/docs/sdks" className="hover:text-white transition-colors">SDKs</a>
            <a href="/docs" className="hover:text-white transition-colors">Docs</a>
            <a href="/articles" className="hover:text-white transition-colors">Articles</a>
            <a href="mailto:hello@dforge.ca" className="hover:text-white transition-colors">Contact</a>
          </div>
          <p className="text-[10px] text-[#2a4a5a] tracking-[0.3em] font-medium uppercase hover:text-[#00F0FF]/50 transition-colors cursor-default">
            Forged by Digital Forge Studios. Tempered by thermodynamics.
          </p>
        </footer>
      </div>
    </div>
  );
}
