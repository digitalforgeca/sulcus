'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/* ── Forward-Flight Memory Tunnel ──────────────────────────────────
   Fly forward through a field of neon memory blocks. Blocks spawn far
   ahead and rush toward the viewer, streaming binary data as they pass.
   Starfield-style depth — you're moving through the memory graph.
   ──────────────────────────────────────────────────────────────── */

interface Block {
  x: number; y: number; z: number;       // world-space (x,y = lateral offset from center)
  w: number; h: number; d: number;
  hue: number;
  phase: number;
  scrollSpeed: number;
  textSeed: number;
}

const TUNNEL_DEPTH = 600;      // how far ahead blocks spawn
const NEAR_CLIP = 5;           // blocks recycle when z drops below this
const FORWARD_SPEED = 0.8;     // base forward velocity per frame
const BLOCK_COUNT = 20;

function NeonBlockCanvas({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blocksRef = useRef<Block[]>([]);
  const frameRef = useRef(0);
  const timeRef = useRef(0);

  const COLORS: [number, number, number][] = [
    [0, 240, 255],   // cyan
    [212, 175, 55],   // gold
    [255, 107, 53],   // orange
  ];

  const textCacheRef = useRef<Map<number, string[]>>(new Map());

  const generateTextColumns = useCallback((seed: number, cols: number, rows: number): string[] => {
    const columns: string[] = [];
    let s = seed;
    for (let c = 0; c < cols; c++) {
      let col = '';
      for (let r = 0; r < rows; r++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        col += s % 2 === 0 ? '1' : '0';
      }
      columns.push(col);
    }
    return columns;
  }, []);

  /** Spawn a block at random lateral position and given depth range */
  const spawnBlock = useCallback((zMin: number, zMax: number): Block => {
    const spread = 1.4; // how wide blocks scatter laterally
    const seed = Math.floor(Math.random() * 100000);
    if (!textCacheRef.current.has(seed)) {
      textCacheRef.current.set(seed, generateTextColumns(seed, 20, 60));
    }
    return {
      x: (Math.random() - 0.5) * width * spread,
      y: (Math.random() - 0.5) * height * spread,
      z: zMin + Math.random() * (zMax - zMin),
      w: Math.random() * 60 + 30,
      h: Math.random() * 60 + 30,
      d: Math.random() * 25 + 10,
      hue: Math.floor(Math.random() * 3),
      phase: Math.random() * Math.PI * 2,
      scrollSpeed: 15 + Math.random() * 35,
      textSeed: seed,
    };
  }, [width, height, generateTextColumns]);

  const initBlocks = useCallback(() => {
    const blocks: Block[] = [];
    for (let i = 0; i < BLOCK_COUNT; i++) {
      blocks.push(spawnBlock(NEAR_CLIP, TUNNEL_DEPTH));
    }
    blocksRef.current = blocks;
  }, [spawnBlock]);

  useEffect(() => {
    initBlocks();
  }, [initBlocks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;
    const cx = width / 2;
    const cy = height / 2;
    const focalLength = 300;

    const animate = () => {
      if (!running) return;
      timeRef.current += 0.016;
      const t = timeRef.current;

      ctx.clearRect(0, 0, width, height);

      const blocks = blocksRef.current;

      // Move blocks toward viewer (decrease z)
      for (const b of blocks) {
        b.z -= FORWARD_SPEED + (TUNNEL_DEPTH - b.z) * 0.0008; // slight acceleration as they near
        // Recycle blocks that pass the camera
        if (b.z < NEAR_CLIP) {
          const recycled = spawnBlock(TUNNEL_DEPTH * 0.85, TUNNEL_DEPTH);
          Object.assign(b, recycled);
        }
      }

      // Depth-sort (far → near)
      blocks.sort((a, b) => b.z - a.z);

      for (const b of blocks) {
        const perspective = focalLength / (b.z + focalLength * 0.3);
        const sx = cx + b.x * perspective;
        const sy = cy + b.y * perspective;
        const sw = b.w * perspective;
        const sh = b.h * perspective;
        const sd = b.d * perspective * 0.4;

        // Skip blocks fully off screen
        if (sx + sw < -20 || sx - sw > width + 20 || sy + sh < -20 || sy - sh > height + 20) continue;

        const proximity = 1 - b.z / TUNNEL_DEPTH; // 0 = far, 1 = near
        const pulse = Math.sin(t * 1.2 + b.phase) * 0.1 + 0.9;
        const depthAlpha = (0.04 + proximity * 0.28) * pulse;
        const [r, g, bl] = COLORS[b.hue];

        // ── Front face with clipped binary text ──
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx - sw / 2, sy - sh / 2, sw, sh);
        ctx.clip();

        ctx.fillStyle = `rgba(5, 10, 15, ${depthAlpha * 2.5})`;
        ctx.fillRect(sx - sw / 2, sy - sh / 2, sw, sh);

        const textCols = textCacheRef.current.get(b.textSeed);
        if (textCols && sw > 8) {
          const fontSize = Math.max(6, Math.min(11, sw / 6));
          ctx.font = `${fontSize}px monospace`;
          const charH = fontSize * 1.2;
          const charW = fontSize * 0.65;
          const colCount = Math.ceil(sw / charW);
          const scrollOffset = (t * b.scrollSpeed) % (charH * 60);

          for (let c = 0; c < colCount && c < textCols.length; c++) {
            const col = textCols[c];
            const colX = sx - sw / 2 + c * charW + charW * 0.3;

            for (let row = 0; row < col.length; row++) {
              let charY = sy - sh / 2 + row * charH - scrollOffset + charH;
              if (charY < sy - sh / 2) charY += col.length * charH;
              if (charY < sy - sh / 2 - charH || charY > sy + sh / 2 + charH) continue;

              const distFromCenter = Math.abs(charY - sy) / (sh / 2);
              const edgeFade = Math.max(0, 1 - Math.pow(distFromCenter, 3));
              const charAlpha = depthAlpha * 1.8 * edgeFade;
              const isBright = (row + Math.floor(t * 2)) % 7 === 0;
              const finalAlpha = isBright ? Math.min(charAlpha * 2.5, 0.9) : charAlpha;

              ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${finalAlpha})`;
              ctx.fillText(col[row], colX, charY);
            }
          }
        }
        ctx.restore();

        // ── Top face ──
        ctx.beginPath();
        ctx.moveTo(sx - sw / 2, sy - sh / 2);
        ctx.lineTo(sx - sw / 2 + sd, sy - sh / 2 - sd);
        ctx.lineTo(sx + sw / 2 + sd, sy - sh / 2 - sd);
        ctx.lineTo(sx + sw / 2, sy - sh / 2);
        ctx.closePath();
        ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${depthAlpha * 0.35})`;
        ctx.fill();

        // ── Right face ──
        ctx.beginPath();
        ctx.moveTo(sx + sw / 2, sy - sh / 2);
        ctx.lineTo(sx + sw / 2 + sd, sy - sh / 2 - sd);
        ctx.lineTo(sx + sw / 2 + sd, sy + sh / 2 - sd);
        ctx.lineTo(sx + sw / 2, sy + sh / 2);
        ctx.closePath();
        ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${depthAlpha * 0.2})`;
        ctx.fill();

        // ── Edge glow ──
        ctx.strokeStyle = `rgba(${r}, ${g}, ${bl}, ${depthAlpha * 1.8})`;
        ctx.lineWidth = 0.7;
        ctx.strokeRect(sx - sw / 2, sy - sh / 2, sw, sh);

        // ── Bloom ──
        if (sw > 4) {
          const glow = ctx.createRadialGradient(sx, sy, sw * 0.2, sx, sy, sw * 0.8);
          glow.addColorStop(0, `rgba(${r}, ${g}, ${bl}, ${depthAlpha * 0.15})`);
          glow.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = glow;
          ctx.fillRect(sx - sw, sy - sh, sw * 2, sh * 2);
        }
      }

      // ── Subtle speed lines (streaking stars effect) ──
      ctx.globalAlpha = 0.06;
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2 + t * 0.02;
        const dist = 60 + Math.sin(t * 0.5 + i) * 20;
        const lx = cx + Math.cos(angle) * dist;
        const ly = cy + Math.sin(angle) * dist;
        const ex = cx + Math.cos(angle) * (dist + 80 + proximity_avg(blocks) * 40);
        const ey = cy + Math.sin(angle) * (dist + 80 + proximity_avg(blocks) * 40);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = '#00F0FF';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, [width, height, spawnBlock]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full h-full"
      style={{ imageRendering: 'auto' }}
    />
  );
}

/** Average proximity of all blocks (0–1, higher = nearer to camera) */
function proximity_avg(blocks: Block[]): number {
  if (blocks.length === 0) return 0;
  let sum = 0;
  for (const b of blocks) sum += 1 - b.z / TUNNEL_DEPTH;
  return sum / blocks.length;
}

export default function Home() {
  const [email, setEmail] = useState('');
  const [joined, setJoined] = useState(false);
  const [vizSize, setVizSize] = useState({ w: 400, h: 250 });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const vizContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = vizContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setVizSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setJoined(true);
    setTimeout(() => {
      window.location.href = '/dashboard';
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed] font-mono selection:bg-[#00F0FF] selection:text-[#050a0f] relative overflow-hidden">
      {/* Background Grids */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.06] z-0" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'100\' viewBox=\'0 0 60 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg stroke=\'%2300F0FF\' stroke-width=\'1\' fill=\'none\' fill-rule=\'evenodd\'%3E%3Cpath d=\'M30 0l30 16.5v33L30 66 0 49.5v-33L30 0zm0 100l30-16.5v-33L30 34 0 50.5v33L30 100z\'/%3E%3C/g%3E%3C/svg%3E")', backgroundSize: '60px 100px' }}></div>
      <div className="absolute inset-0 pointer-events-none opacity-[0.02] z-0" style={{ backgroundImage: 'linear-gradient(#00F0FF 1px, transparent 1px), linear-gradient(90deg, #00F0FF 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>

      <div className="max-w-[1100px] mx-auto px-8 relative z-10">
        {/* Navigation */}
        <nav className="flex justify-between items-center py-6 md:py-8 border-b border-[#D4AF37]/30">
          <div className="text-xl md:text-2xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-2">
            <div className="w-2.5 h-2.5 md:w-3 md:h-3 bg-[#00F0FF] rounded-sm shadow-[0_0_8px_#00F0FF]"></div>
            SULCUS
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex gap-8 text-sm font-medium text-[#888] uppercase tracking-wider items-center">
            <a href="/membench" className="hover:text-[#00F0FF] transition-colors">Benchmarks</a>
            <a href="/articles" className="hover:text-[#00F0FF] transition-colors">Articles</a>
            <a href="https://github.com/digitalforgeca/sulcus" className="hover:text-white transition-colors">GitHub</a>
            <div className="h-4 w-[1px] bg-[#D4AF37]/30"></div>
            <a href="/docs" className="text-[#888] hover:text-white transition-colors text-sm uppercase tracking-widest">Docs</a>
            <a href="/login" className="text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#050a0f] transition-colors border border-[#D4AF37] px-6 py-2 shadow-[0_0_10px_rgba(212,175,55,0.2)] uppercase">Sign In</a>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 text-[#888] hover:text-[#D4AF37] transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation"
          >
            {mobileMenuOpen ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </nav>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-b border-[#D4AF37]/20 bg-[#0a1520]/90 backdrop-blur-sm -mx-8 px-8 py-4 animate-in slide-in-from-top-2 duration-200">
            <div className="flex flex-col gap-1 text-sm font-medium text-[#888] uppercase tracking-wider">
              <a href="/membench" onClick={() => setMobileMenuOpen(false)} className="hover:text-[#00F0FF] transition-colors py-3 border-b border-[#222]">Benchmarks</a>
              <a href="/articles" onClick={() => setMobileMenuOpen(false)} className="hover:text-[#00F0FF] transition-colors py-3 border-b border-[#222]">Articles</a>
              <a href="/docs" onClick={() => setMobileMenuOpen(false)} className="hover:text-white transition-colors py-3 border-b border-[#222]">Docs</a>
              <a href="https://github.com/digitalforgeca/sulcus" className="hover:text-white transition-colors py-3 border-b border-[#222]">GitHub</a>
              <div className="pt-3">
                <a href="/login" className="inline-block text-[#D4AF37] border border-[#D4AF37] px-6 py-2.5 shadow-[0_0_10px_rgba(212,175,55,0.2)] uppercase hover:bg-[#D4AF37] hover:text-[#050a0f] transition-colors text-center w-full">Sign In</a>
              </div>
            </div>
          </div>
        )}
        
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
            Your agent forgets everything the moment its context window fills. SULCUS gives it a <span className="text-white font-semibold">real memory</span> — a thermodynamic graph that heats what matters, cools what doesn&apos;t, and pages the right context in at the right time. Token burn drops up to <span className="text-[#00F0FF] font-bold">90%</span>. Recall goes to <span className="text-[#00F0FF] font-bold">100%</span>.
          </p>
          
          <div className="flex flex-col md:flex-row justify-center items-center gap-4">
            <a href="/dashboard" className="w-full md:w-auto bg-[#D4AF37] text-[#050a0f] px-10 py-4 font-bold hover:brightness-110 transition-all tracking-widest uppercase shadow-[0_0_20px_rgba(212,175,55,0.3)]">
              Start Building
            </a>
            <a href="https://github.com/digitalforgeca/sulcus" className="w-full md:w-auto bg-transparent border border-[#888] text-white px-10 py-4 font-bold hover:border-white transition-all tracking-widest uppercase">
              View Source
            </a>
          </div>
        </header>

        {/* The Problem & Solution Flow */}
        <section className="py-24 border-y border-[#D4AF37]/20 bg-[#0a1520]/30 relative">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-xs tracking-[0.5em] text-[#00F0FF] uppercase mb-4">The Approach</h2>
              <h3 className="text-3xl font-bold mb-6 text-white uppercase tracking-tighter leading-tight">We didn&apos;t contort the LLM. We accelerated the system around it.</h3>
              <p className="text-[#888] font-sans leading-relaxed mb-6">
                Most memory systems fight the model — cramming history into shrinking windows or bolting on clumsy retrieval. SULCUS works <em className="text-white not-italic">with</em> the architecture. Memories heat up when relevant, cool when stale, and flow between agents like neural pathways forming in real time. Bio-mechanical, not brute force.
              </p>
              <ul className="space-y-4 font-sans text-sm">
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 bg-[#FF6B35] mt-1.5 shrink-0 shadow-[0_0_5px_#FF6B35]"></div>
                  <span>Agents that remember across sessions, restarts, and deployments.</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 bg-[#FF6B35] mt-1.5 shrink-0 shadow-[0_0_5px_#FF6B35]"></div>
                  <span>10x reduction in token spend. Same accuracy. Better recall.</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 bg-[#FF6B35] mt-1.5 shrink-0 shadow-[0_0_5px_#FF6B35]"></div>
                  <span>Multi-agent memory mesh — shared context without shared prompts.</span>
                </li>
              </ul>
            </div>
            
            <div ref={vizContainerRef} className="relative border border-[#D4AF37]/20 bg-[#050a0f] shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-hidden" style={{ minHeight: '280px' }}>
              <div className="absolute -top-3 -left-3 w-6 h-6 border-t-2 border-l-2 border-[#D4AF37] z-10"></div>
              <div className="absolute -bottom-3 -right-3 w-6 h-6 border-b-2 border-r-2 border-[#D4AF37] z-10"></div>
              
              <div className="absolute inset-0">
                <NeonBlockCanvas width={vizSize.w} height={vizSize.h} />
              </div>
              
              {/* Overlay text — the system breathes */}
              <div className="absolute bottom-4 left-0 right-0 text-center z-10">
                <p className="text-[10px] tracking-[0.4em] text-[#00F0FF]/40 uppercase font-mono">
                  Flying through memory
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Grid: The SULCUS Stack */}
        <section className="py-24">
          <div className="text-center mb-20">
            <h2 className="text-3xl font-bold mb-4 text-white uppercase tracking-widest">Autonomous Memory Ecosystem</h2>
            <p className="text-[#888] max-w-xl mx-auto font-sans">Three specialized vectors for perfect long-term recall.</p>
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
                  desc: "Self-host the entire stack — server, database, sync — in your own infrastructure. The MIT-licensed core means no vendor lock-in, no phone-home telemetry, no surprises.",
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
              GDPR-ready · SOC2 roadmap · No telemetry · MIT licensed core
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
                <div className="text-[10px] text-[#888] uppercase tracking-widest">Internal Build Time</div>
              </div>
              <div>
                <div className="text-4xl font-bold text-[#00F0FF] mb-2 font-mono">100%</div>
                <div className="text-[10px] text-[#888] uppercase tracking-widest">Data Sovereignty</div>
              </div>
              <div>
                <div className="text-4xl font-bold text-[#00F0FF] mb-2 font-mono">Zero</div>
                <div className="text-[10px] text-[#888] uppercase tracking-widest">External Egress</div>
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
                  placeholder="AGENT IDENTIFIER (EMAIL)" 
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
                Privacy-first. Secure. MIT Licensed Core.
              </p>
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="py-16 border-t border-[#D4AF37]/20 text-center">
          <div className="flex justify-center gap-8 mb-8 text-xs text-[#555] uppercase tracking-widest">
            <a href="https://github.com/digitalforgeca/sulcus" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">GitHub</a>
            <a href="/docs" className="hover:text-white transition-colors">Docs</a>
            <a href="mailto:apouriliaee+sulcus@gmail.com" className="hover:text-white transition-colors">Support</a>
            <a href="/docs" className="hover:text-white transition-colors">API</a>
          </div>
          <p className="text-[10px] text-[#2a4a5a] tracking-[0.3em] font-medium uppercase hover:text-[#00F0FF]/50 transition-colors cursor-default">
            Forged in Rust. Tempered by thermodynamics. 🦀
          </p>
        </footer>
      </div>
    </div>
  );
}
