'use client';

import { useState, useEffect } from 'react';

export default function Home() {
  const [email, setEmail] = useState('');
  const [joined, setJoined] = useState(false);

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
              <h2 className="text-xs tracking-[0.5em] text-[#00F0FF] uppercase mb-4">The Challenge</h2>
              <h3 className="text-3xl font-bold mb-6 text-white uppercase tracking-tighter leading-tight">Context windows are the new RAM, and you&apos;re leaking it.</h3>
              <p className="text-[#888] font-sans leading-relaxed mb-6">
                Most agent architectures either blast the full history into every call (expensive) or use naive RAG (lossy). SULCUS models memory like a brain — knowledge decays when ignored, ignites when relevant, and flows between agents like shared experience.
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
            
            <div className="relative p-8 border border-[#D4AF37]/20 bg-[#050a0f] shadow-[0_0_40px_rgba(0,0,0,0.5)]">
              <div className="absolute -top-3 -left-3 w-6 h-6 border-t-2 border-l-2 border-[#D4AF37]"></div>
              <div className="absolute -bottom-3 -right-3 w-6 h-6 border-b-2 border-r-2 border-[#D4AF37]"></div>
              
              <h4 className="text-[10px] tracking-[0.3em] text-[#D4AF37] uppercase mb-8 text-center">vMMU Pipeline Architecture</h4>
              <svg width="400" height="200" viewBox="0 0 400 200" className="w-full h-auto">
                {/* Agent */}
                <rect x="20" y="70" width="80" height="60" fill="none" stroke="#D4AF37" strokeWidth="1" />
                <text x="60" y="105" fill="#fff" fontSize="10" textAnchor="middle" alignmentBaseline="middle">AGENT</text>
                
                {/* SULCUS */}
                <path d="M100 100 L140 100" stroke="#00F0FF" strokeWidth="1" strokeDasharray="4,4" />
                <rect x="140" y="40" width="120" height="120" fill="#0a1520" stroke="#00F0FF" strokeWidth="1" />
                <text x="200" y="60" fill="#00F0FF" fontSize="8" textAnchor="middle" letterSpacing="0.1em">SULCUS vMMU</text>
                
                {/* Nodes */}
                <circle cx="170" cy="100" r="10" fill="#FF6B35" className="animate-pulse" />
                <circle cx="210" cy="85" r="6" fill="#D4AF37" />
                <circle cx="230" cy="120" r="4" fill="#00F0FF" opacity="0.5" />
                
                {/* LLM */}
                <path d="M260 100 L300 100" stroke="#00F0FF" strokeWidth="1" />
                <rect x="300" y="70" width="80" height="60" fill="none" stroke="#D4AF37" strokeWidth="1" />
                <text x="340" y="105" fill="#fff" fontSize="10" textAnchor="middle" alignmentBaseline="middle">LLM API</text>
                
                <text x="280" y="90" fill="#00F0FF" fontSize="8" textAnchor="middle">↓ 90%</text>
              </svg>
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
