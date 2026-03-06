'use client';

import { useState } from 'react';

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
      {/* Hex Grid Background Pattern */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.06] z-0" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'100\' viewBox=\'0 0 60 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg stroke=\'%2300F0FF\' stroke-width=\'1\' fill=\'none\' fill-rule=\'evenodd\'%3E%3Cpath d=\'M30 0l30 16.5v33L30 66 0 49.5v-33L30 0zm0 100l30-16.5v-33L30 34 0 50.5v33L30 100z\'/%3E%3C/g%3E%3C/svg%3E")', backgroundSize: '60px 100px' }}></div>
      <div className="absolute inset-0 pointer-events-none opacity-[0.02] z-0" style={{ backgroundImage: 'linear-gradient(#00F0FF 1px, transparent 1px), linear-gradient(90deg, #00F0FF 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>

      <div className="max-w-[1000px] mx-auto px-8 relative z-10">
        <nav className="flex justify-between items-center py-8 border-b border-[#D4AF37]/30">
          <div className="text-2xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-2">
            <div className="w-3 h-3 bg-[#00F0FF] rounded-sm shadow-[0_0_8px_#00F0FF]"></div>
            SULCUS
          </div>
          <div className="flex gap-8 text-sm font-medium text-[#888] uppercase tracking-wider items-center">
            <a href="/performance" className="hover:text-[#00F0FF] transition-colors">Benchmarks</a>
            <a href="https://github.com/digitalforgeca/sulcus" className="hover:text-white transition-colors">GitHub Docs</a>
            <a href="/dashboard" className="text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#050a0f] transition-colors border border-[#D4AF37] px-6 py-2 shadow-[0_0_10px_rgba(212,175,55,0.2)] inset-shadow">CONSOLE</a>
          </div>
        </nav>
        
        <header className="text-center py-20 md:py-24 relative">
          {/* Deco Rule Top */}
          <div className="flex items-center justify-center mb-8 opacity-50">
            <div className="h-[1px] w-16 bg-gradient-to-l from-[#D4AF37] to-transparent"></div>
            <div className="w-2 h-2 rotate-45 bg-[#00F0FF] mx-4 shadow-[0_0_5px_#00F0FF]"></div>
            <div className="h-[1px] w-16 bg-gradient-to-r from-[#D4AF37] to-transparent"></div>
          </div>

          <h1 className="text-6xl md:text-8xl font-bold mb-4 tracking-tighter text-white" style={{ textShadow: '0 0 30px rgba(0, 240, 255, 0.3)' }}>
            SULCUS
          </h1>
          <p className="text-xl md:text-2xl text-[#D4AF37] mb-8 font-sans tracking-wide uppercase">
            The Virtual Memory Management Unit for AI Agents.
          </p>

          {/* Hero Metrics Strip */}
          <div className="flex flex-wrap justify-center gap-8 md:gap-16 mb-12">
            <div className="flex flex-col items-center">
              <span className="text-4xl font-bold text-[#00F0FF]">90%</span>
              <span className="text-xs text-[#888] uppercase tracking-widest mt-1">Token Reduction</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-4xl font-bold text-[#00F0FF]">&lt;50ms</span>
              <span className="text-xs text-[#888] uppercase tracking-widest mt-1">Context Build</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-4xl font-bold text-[#00F0FF]">∞</span>
              <span className="text-xs text-[#888] uppercase tracking-widest mt-1">Memory Horizon</span>
            </div>
          </div>

          <p className="text-lg mb-12 max-w-2xl mx-auto text-cyan-50/70 font-sans leading-relaxed">
            Stop burning tokens on history. SULCUS intercepts your agent's context stream, intelligently pages thermodynamic memories, and only sends what matters to the LLM.
          </p>
          
          {joined ? (
            <div className="bg-[#0a1520] border border-[#00F0FF] text-[#00F0FF] px-8 py-4 font-bold inline-block animate-pulse shadow-[0_0_15px_rgba(0,240,255,0.2)]">
              [ STATUS: ENROLLED. REDIRECTING... ]
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-12 max-w-md mx-auto flex">
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ENTER AGENT IDENTIFIER (EMAIL)" 
                className="flex-1 bg-[#0a1520] border border-[#D4AF37] border-r-0 px-6 py-4 focus:border-[#00F0FF] focus:outline-none transition-colors text-white placeholder-[#D4AF37]/40 text-sm uppercase tracking-wider"
                required
              />
              <button
                type="submit"
                className="bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-[#050a0f] px-8 py-4 font-bold hover:brightness-125 transition-all whitespace-nowrap tracking-wider"
              >
                INITIALIZE
              </button>
            </form>
          )}
        </header>

        {/* SVG Flow Diagram */}
        <div className="w-full flex justify-center py-12 mb-16 border-y border-[#D4AF37]/20 relative bg-[#0a1520]/50">
           <svg width="800" height="200" viewBox="0 0 800 200" className="max-w-full h-auto">
             {/* Agent Box */}
             <rect x="50" y="70" width="120" height="60" fill="#050a0f" stroke="#D4AF37" strokeWidth="2" />
             <text x="110" y="105" fill="#fff" fontSize="14" fontFamily="monospace" textAnchor="middle" alignmentBaseline="middle">AI AGENT</text>
             
             {/* Flow to vMMU */}
             <path d="M170 100 L250 100" stroke="#00F0FF" strokeWidth="2" strokeDasharray="5,5" className="animate-[dash_2s_linear_infinite]" />
             <polygon points="240,95 250,100 240,105" fill="#00F0FF" />

             {/* vMMU Brain */}
             <rect x="250" y="40" width="300" height="120" fill="#0a1520" stroke="#00F0FF" strokeWidth="2" />
             <text x="400" y="60" fill="#00F0FF" fontSize="12" fontFamily="monospace" textAnchor="middle" letterSpacing="0.1em">SULCUS vMMU (THERMODYNAMIC GRAPH)</text>
             
             {/* Nodes in vMMU */}
             {/* Hot Node */}
             <circle cx="300" cy="100" r="15" fill="#FF6B35" />
             <circle cx="300" cy="100" r="20" fill="none" stroke="#FF6B35" strokeWidth="1" strokeDasharray="2,2" />
             {/* Warm Node */}
             <circle cx="360" cy="85" r="10" fill="#D4AF37" />
             {/* Cool Node */}
             <circle cx="440" cy="115" r="8" fill="#00F0FF" opacity="0.6" />
             {/* Cold Node */}
             <circle cx="500" cy="90" r="6" fill="#888" opacity="0.3" />
             
             {/* Edges */}
             <line x1="315" y1="100" x2="350" y2="85" stroke="#D4AF37" strokeWidth="1" />
             <line x1="370" y1="85" x2="432" y2="115" stroke="#00F0FF" strokeWidth="1" opacity="0.5" />
             <line x1="448" y1="115" x2="494" y2="90" stroke="#888" strokeWidth="1" opacity="0.2" />

             {/* Flow to LLM */}
             <path d="M550 100 L630 100" stroke="#00F0FF" strokeWidth="2" />
             <polygon points="620,95 630,100 620,105" fill="#00F0FF" />
             <text x="590" y="90" fill="#00F0FF" fontSize="10" fontFamily="monospace" textAnchor="middle">↓ 90% Tokens</text>

             {/* LLM Box */}
             <rect x="630" y="70" width="120" height="60" fill="#050a0f" stroke="#D4AF37" strokeWidth="2" />
             <text x="690" y="105" fill="#fff" fontSize="14" fontFamily="monospace" textAnchor="middle" alignmentBaseline="middle">LLM API</text>
           </svg>
        </div>

        {/* 3-Step Iconographic Strip */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-12 my-24 relative">
          {/* Step 1 */}
          <div className="flex flex-col items-center text-center group">
            <div className="w-16 h-16 border border-[#D4AF37] rotate-45 flex items-center justify-center mb-8 group-hover:bg-[#D4AF37]/10 transition-colors shadow-[0_0_15px_rgba(212,175,55,0.1)]">
              <div className="-rotate-45 text-[#D4AF37]">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </div>
            </div>
            <h3 className="text-lg font-bold text-white mb-2 tracking-widest uppercase">1. INGEST</h3>
            <p className="text-sm text-[#888] font-sans">Agents stream interactions into the local memory mapped index via a zero-latency socket.</p>
          </div>
          
          {/* Step 2 */}
          <div className="flex flex-col items-center text-center group">
            <div className="w-16 h-16 border border-[#FF6B35] rotate-45 flex items-center justify-center mb-8 group-hover:bg-[#FF6B35]/10 transition-colors shadow-[0_0_15px_rgba(255,107,53,0.1)]">
              <div className="-rotate-45 text-[#FF6B35]">
                 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              </div>
            </div>
            <h3 className="text-lg font-bold text-white mb-2 tracking-widest uppercase">2. THERMAL DECAY</h3>
            <p className="text-sm text-[#888] font-sans">Concepts are embedded as graph nodes. Heat diffuses across relationships and decays exponentially over time.</p>
          </div>

          {/* Step 3 */}
          <div className="flex flex-col items-center text-center group">
            <div className="w-16 h-16 border border-[#00F0FF] rotate-45 flex items-center justify-center mb-8 group-hover:bg-[#00F0FF]/10 transition-colors shadow-[0_0_15px_rgba(0,240,255,0.1)]">
              <div className="-rotate-45 text-[#00F0FF]">
                 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </div>
            </div>
            <h3 className="text-lg font-bold text-white mb-2 tracking-widest uppercase">3. SELECTIVE RECALL</h3>
            <p className="text-sm text-[#888] font-sans">Only the most thermodynamically active (salient) nodes are paged into the LLM context window.</p>
          </div>
        </section>

        {/* Benefit Cards */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8 my-24">
          <div className="bg-[#0a1520] p-8 relative border border-[#D4AF37]/20 hover:border-[#00F0FF]/50 transition-colors shadow-[0_4px_20px_rgba(0,0,0,0.5)] group">
            <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-[#D4AF37]"></div>
            <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-[#D4AF37]"></div>
            <h3 className="text-xl font-bold mb-4 text-[#00F0FF] tracking-wider uppercase group-hover:text-white transition-colors">Slash Your LLM Bill</h3>
            <p className="text-[#888] font-sans text-sm leading-relaxed">
              Stop paying to resend 100,000 tokens of static history on every single turn. SULCUS radically compresses context payloads without losing semantic fidelity.
            </p>
          </div>
          <div className="bg-[#0a1520] p-8 relative border border-[#D4AF37]/20 hover:border-[#00F0FF]/50 transition-colors shadow-[0_4px_20px_rgba(0,0,0,0.5)] group">
            <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-[#D4AF37]"></div>
            <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-[#D4AF37]"></div>
            <h3 className="text-xl font-bold mb-4 text-[#00F0FF] tracking-wider uppercase group-hover:text-white transition-colors">Local Data Sovereignty</h3>
            <p className="text-[#888] font-sans text-sm leading-relaxed">
              Built on an embedded Postgres engine (PGlite). Your agent's memory graph never leaves your machine unless you explicitly configure fleet synchronization.
            </p>
          </div>
        </section>

        <h2 className="text-4xl font-bold text-center mt-32 mb-16 tracking-widest text-[#D4AF37] uppercase">Deployment Protocols</h2>
        
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch mb-32">
          {/* OPEN TIER */}
          <div className="text-center p-10 border border-[#D4AF37]/30 bg-[#0a1520] relative flex flex-col h-full">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-[2px] bg-[#D4AF37]/50"></div>
            <h3 className="text-xl font-bold tracking-widest text-white">SULCUS OPEN</h3>
            <div className="text-4xl font-bold my-6 text-[#D4AF37]">$0</div>
            <ul className="text-[#888] space-y-4 mb-10 font-sans text-sm text-left mx-auto">
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#00F0FF]"></div>MIT Licensed Core</li>
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#00F0FF]"></div>Local PGlite Backend</li>
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#00F0FF]"></div>Standard MCP Support</li>
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#00F0FF]"></div>Browser Extension</li>
            </ul>
            <a href="https://github.com/digitalforgeca/sulcus" className="mt-auto inline-block w-full bg-transparent border border-[#D4AF37] text-[#D4AF37] py-3 rounded font-bold hover:bg-[#D4AF37]/10 transition-all tracking-widest">GET SOURCE</a>
          </div>
          
          {/* TEAM TIER */}
          <div className="text-center p-12 border border-[#D4AF37] bg-[#0a1520] relative flex flex-col h-full shadow-[0_0_30px_rgba(212,175,55,0.15)] z-10 -mt-4 mb-4">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#D4AF37] text-[#050a0f] text-xs font-bold px-4 py-1 tracking-widest">RECOMMENDED</div>
            <h3 className="text-2xl font-bold tracking-widest text-white mt-4">SULCUS TEAM</h3>
            <div className="text-5xl font-bold my-6 text-[#D4AF37]">$299<span className="text-lg text-[#888] font-normal">/mo</span></div>
            <ul className="text-[#ddd] space-y-4 mb-12 font-sans text-sm text-left mx-auto">
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rotate-45 bg-[#D4AF37]"></div>Cloud Sync for Agent Fleets</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rotate-45 bg-[#D4AF37]"></div>Advanced Heat Diffusion</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rotate-45 bg-[#D4AF37]"></div>100GB Storage Limit</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rotate-45 bg-[#D4AF37]"></div>Remote MCP via SSE</li>
            </ul>
            <a href="/dashboard/billing" className="mt-auto inline-block w-full bg-gradient-to-r from-[#D4AF37] to-[#B8860B] text-[#050a0f] py-4 font-bold hover:brightness-110 transition-all tracking-widest">UPGRADE TO TEAM</a>
          </div>

          {/* ENTERPRISE TIER */}
          <div className="text-center p-10 border border-[#00F0FF]/40 bg-[#0a1520] relative flex flex-col h-full shadow-[0_0_20px_rgba(0,240,255,0.05)]">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-[2px] bg-[#00F0FF]/50"></div>
            <h3 className="text-xl font-bold tracking-widest text-white">ENTERPRISE</h3>
            <div className="text-4xl font-bold my-6 text-[#00F0FF]">CUSTOM</div>
            <ul className="text-[#888] space-y-4 mb-10 font-sans text-sm text-left mx-auto">
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#D4AF37]"></div>Multi-tenant Server</li>
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#D4AF37]"></div>Distributed Vector Cache</li>
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#D4AF37]"></div>SOC2 / Private Cloud</li>
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#D4AF37]"></div>SSO Integration</li>
            </ul>
            <a href="mailto:hello@sulcus.io" className="mt-auto inline-block w-full bg-transparent border border-[#00F0FF] text-[#00F0FF] py-3 font-bold hover:bg-[#00F0FF]/10 transition-colors tracking-widest">CONTACT SALES</a>
          </div>
        </section>

        <footer className="text-center py-16 border-t border-[#D4AF37]/20 text-[#2a4a5a] text-sm tracking-[0.2em] font-medium hover:text-[#00F0FF]/50 transition-colors">
          BUILT WITH RUST AND 🦀 FOR THE AGENTIC FUTURE
        </footer>
      </div>
    </div>
  );
}