'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/* ── Neon Block Visualization ─────────────────────────────────────
   Floating translucent 3D blocks with binary streams rushing through.
   Bio-mechanical: we didn't force the LLM to conform — we accelerated
   the underlying system. Organic motion, crystalline structure.
   ──────────────────────────────────────────────────────────────── */

interface Block {
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  vx: number; vy: number; vz: number;
  hue: number; // 0=cyan, 1=gold, 2=orange
  phase: number;
}

interface BinaryBit {
  x: number; y: number;
  vx: number; vy: number;
  char: string;
  life: number;
  maxLife: number;
  opacity: number;
}

function NeonBlockCanvas({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blocksRef = useRef<Block[]>([]);
  const bitsRef = useRef<BinaryBit[]>([]);
  const frameRef = useRef(0);
  const timeRef = useRef(0);

  const COLORS = [
    [0, 240, 255],   // cyan
    [212, 175, 55],   // gold
    [255, 107, 53],   // orange
  ];

  const initBlocks = useCallback(() => {
    const blocks: Block[] = [];
    for (let i = 0; i < 12; i++) {
      blocks.push({
        x: Math.random() * width,
        y: Math.random() * height,
        z: Math.random() * 200 + 50,
        w: Math.random() * 60 + 20,
        h: Math.random() * 60 + 20,
        d: Math.random() * 40 + 10,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.2,
        vz: (Math.random() - 0.5) * 0.1,
        hue: Math.floor(Math.random() * 3),
        phase: Math.random() * Math.PI * 2,
      });
    }
    blocksRef.current = blocks;
  }, [width, height]);

  const spawnBits = useCallback(() => {
    const bits = bitsRef.current;
    if (bits.length > 80) return;
    // Spawn from random block edges
    const blocks = blocksRef.current;
    if (blocks.length === 0) return;
    const b = blocks[Math.floor(Math.random() * blocks.length)];
    const scale = 300 / (b.z + 100);
    const sx = b.x * scale;
    const sy = b.y * scale;
    for (let i = 0; i < 3; i++) {
      bits.push({
        x: sx + (Math.random() - 0.5) * b.w * scale,
        y: sy + (Math.random() - 0.5) * b.h * scale,
        vx: (Math.random() - 0.5) * 2.5,
        vy: (Math.random() - 0.5) * 1.5 - 0.3,
        char: Math.random() > 0.5 ? '1' : '0',
        life: 0,
        maxLife: 60 + Math.random() * 80,
        opacity: 0.3 + Math.random() * 0.5,
      });
    }
  }, []);

  useEffect(() => {
    initBlocks();
  }, [initBlocks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;
    const animate = () => {
      if (!running) return;
      timeRef.current += 0.016;
      const t = timeRef.current;

      ctx.clearRect(0, 0, width, height);

      // Update & draw blocks (sorted by z for depth)
      const blocks = blocksRef.current.sort((a, b) => b.z - a.z);
      for (const b of blocks) {
        b.x += b.vx;
        b.y += b.vy;
        b.z += b.vz;
        // Soft bounds
        if (b.x < -50 || b.x > width + 50) b.vx *= -1;
        if (b.y < -50 || b.y > height + 50) b.vy *= -1;
        if (b.z < 30 || b.z > 300) b.vz *= -1;

        const scale = 300 / (b.z + 100);
        const sx = b.x * scale;
        const sy = b.y * scale;
        const sw = b.w * scale;
        const sh = b.h * scale;
        const sd = b.d * scale * 0.5;

        const pulse = Math.sin(t * 1.5 + b.phase) * 0.15 + 0.85;
        const [r, g, bl] = COLORS[b.hue];
        const alpha = (0.08 + (1 - b.z / 350) * 0.12) * pulse;

        // 3D block — front face
        ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${alpha})`;
        ctx.fillRect(sx - sw / 2, sy - sh / 2, sw, sh);

        // Top face (parallelogram)
        ctx.beginPath();
        ctx.moveTo(sx - sw / 2, sy - sh / 2);
        ctx.lineTo(sx - sw / 2 + sd, sy - sh / 2 - sd);
        ctx.lineTo(sx + sw / 2 + sd, sy - sh / 2 - sd);
        ctx.lineTo(sx + sw / 2, sy - sh / 2);
        ctx.closePath();
        ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${alpha * 0.6})`;
        ctx.fill();

        // Right face
        ctx.beginPath();
        ctx.moveTo(sx + sw / 2, sy - sh / 2);
        ctx.lineTo(sx + sw / 2 + sd, sy - sh / 2 - sd);
        ctx.lineTo(sx + sw / 2 + sd, sy + sh / 2 - sd);
        ctx.lineTo(sx + sw / 2, sy + sh / 2);
        ctx.closePath();
        ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${alpha * 0.4})`;
        ctx.fill();

        // Edge glow
        ctx.strokeStyle = `rgba(${r}, ${g}, ${bl}, ${alpha * 2.5})`;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(sx - sw / 2, sy - sh / 2, sw, sh);

        // Inner glow core
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, sw * 0.6);
        glow.addColorStop(0, `rgba(${r}, ${g}, ${bl}, ${alpha * 0.3})`);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(sx - sw, sy - sh, sw * 2, sh * 2);
      }

      // Spawn binary bits
      if (Math.random() < 0.3) spawnBits();

      // Update & draw bits
      const bits = bitsRef.current;
      for (let i = bits.length - 1; i >= 0; i--) {
        const bit = bits[i];
        bit.x += bit.vx;
        bit.y += bit.vy;
        bit.life++;
        if (bit.life > bit.maxLife) {
          bits.splice(i, 1);
          continue;
        }
        const fadeIn = Math.min(bit.life / 10, 1);
        const fadeOut = Math.max(1 - (bit.life - bit.maxLife * 0.7) / (bit.maxLife * 0.3), 0);
        const a = bit.opacity * fadeIn * fadeOut;
        ctx.font = '10px monospace';
        ctx.fillStyle = `rgba(0, 240, 255, ${a})`;
        ctx.fillText(bit.char, bit.x, bit.y);
      }

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, [width, height, spawnBits]);

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

export default function Home() {
  const [email, setEmail] = useState('');
  const [joined, setJoined] = useState(false);
  const [vizSize, setVizSize] = useState({ w: 400, h: 250 });

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
        <nav className="flex justify-between items-center py-8 border-b border-[#D4AF37]/30">
          <div className="text-2xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-2">
            <div className="w-3 h-3 bg-[#00F0FF] rounded-sm shadow-[0_0_8px_#00F0FF]"></div>
            SULCUS
          </div>
          <div className="flex gap-8 text-sm font-medium text-[#888] uppercase tracking-wider items-center">
            <a href="/performance" className="hover:text-[#00F0FF] transition-colors">Benchmarks</a>
            <a href="https://github.com/digitalforgeca/sulcus" className="hover:text-white transition-colors">GitHub</a>
            <div className="h-4 w-[1px] bg-[#D4AF37]/30"></div>
            <a href="/login" className="text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#050a0f] transition-colors border border-[#D4AF37] px-6 py-2 shadow-[0_0_10px_rgba(212,175,55,0.2)] uppercase">Sign In</a>
          </div>
        </nav>
        
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
                  Memory in motion
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
            <a href="/performance" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors flex items-center justify-center gap-2">
              View Detailed Latency Audit <span>&rarr;</span>
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
            <a href="https://github.com/digitalforgeca/sulcus" className="hover:text-white transition-colors">GitHub</a>
            <a href="mailto:apouriliaee+sulcus@gmail.com" className="hover:text-white transition-colors">Support</a>
            <a href="/performance" className="hover:text-white transition-colors">Performance</a>
          </div>
          <p className="text-[10px] text-[#2a4a5a] tracking-[0.3em] font-medium uppercase hover:text-[#00F0FF]/50 transition-colors cursor-default">
            Forged in Rust. Tempered by thermodynamics. 🦀
          </p>
        </footer>
      </div>
    </div>
  );
}
