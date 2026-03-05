'use client';

import { useState } from 'react';
import Image from "next/image";

export default function Home() {
  const [email, setEmail] = useState('');
  const [joined, setJoined] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setJoined(true);
  };

  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed] font-mono selection:bg-[#00F0FF] selection:text-[#050a0f] relative overflow-hidden">
      {/* Hex Grid Background Pattern */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.06] z-0" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'100\' viewBox=\'0 0 60 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg stroke=\'%2300F0FF\' stroke-width=\'1\' fill=\'none\' fill-rule=\'evenodd\'%3E%3Cpath d=\'M30 0l30 16.5v33L30 66 0 49.5v-33L30 0zm0 100l30-16.5v-33L30 34 0 50.5v33L30 100z\'/%3E%3C/g%3E%3C/svg%3E")', backgroundSize: '60px 100px' }}></div>

      <div className="max-w-[1000px] mx-auto px-8 relative z-10">
        <nav className="flex justify-between items-center py-8 border-b border-[#D4AF37]/30">
          <div className="text-2xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-2">
            <div className="w-3 h-3 bg-[#00F0FF] rounded-sm shadow-[0_0_8px_#00F0FF]"></div>
            SULCUS
          </div>
          <div className="flex gap-8 text-sm font-medium text-[#888] uppercase tracking-wider items-center">
            <a href="/performance" className="hover:text-[#00F0FF] transition-colors">Benchmarks</a>
            <a href="https://github.com/sulcus-labs/sulcus" className="hover:text-white transition-colors">GitHub Docs</a>
            <a href="/dashboard" className="text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#050a0f] transition-colors border border-[#D4AF37] px-6 py-2 shadow-[0_0_10px_rgba(212,175,55,0.2)] inset-shadow">CONSOLE</a>
          </div>
        </nav>
        
        <header className="text-center py-20 md:py-32 relative">
          {/* Deco Rule Top */}
          <div className="flex items-center justify-center mb-12 opacity-50">
            <div className="h-[1px] w-16 bg-gradient-to-l from-[#D4AF37] to-transparent"></div>
            <div className="w-2 h-2 rotate-45 bg-[#00F0FF] mx-4 shadow-[0_0_5px_#00F0FF]"></div>
            <div className="h-[1px] w-16 bg-gradient-to-r from-[#D4AF37] to-transparent"></div>
          </div>

          <h1 className="text-6xl md:text-8xl font-bold mb-6 tracking-tighter text-white" style={{ textShadow: '0 0 30px rgba(0, 240, 255, 0.3)' }}>
            SULCUS
          </h1>
          <p className="text-xl md:text-2xl text-[#D4AF37] mb-8 font-sans tracking-wide uppercase">
            The Virtual Memory Management Unit for AI Agents.
          </p>
          <p className="text-lg mb-12 max-w-2xl mx-auto text-cyan-50/70 font-sans leading-relaxed">
            Stop burning tokens on history. Reduce token burn by up to <strong className="text-[#00F0FF]">90%</strong> by giving your agent a mind that intelligently pages context.
          </p>
          
          {joined ? (
            <div className="bg-[#0a1520] border border-[#00F0FF] text-[#00F0FF] px-8 py-4 font-bold inline-block animate-pulse shadow-[0_0_15px_rgba(0,240,255,0.2)]">
              [ STATUS: ENROLLED. AWAITING CLEARANCE. ]
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

          {/* Deco Rule Bottom */}
          <div className="flex items-center justify-center mt-20 opacity-50">
            <div className="h-[1px] w-32 bg-gradient-to-l from-[#D4AF37] to-transparent"></div>
            <div className="w-2 h-2 rotate-45 bg-[#D4AF37] mx-4"></div>
            <div className="h-[1px] w-32 bg-gradient-to-r from-[#D4AF37] to-transparent"></div>
          </div>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-8 my-16">
          {[
            {
              title: "THERMODYNAMIC MEMORY",
              desc: "Knowledge graph nodes that gain heat on use and decay over time. Autonomous context management."
            },
            {
              title: "RUST + POSTGRES",
              desc: "Sub-50ms context builds. High performance local persistence via an embedded PG15 instance."
            },
            {
              title: "ZERO-COPY HOT PATH",
              desc: "Mapped memory shared index. No serialization overhead between the vMMU and your agent runtime."
            }
          ].map((feature, i) => (
            <div key={i} className="bg-[#0a1520] p-8 relative border border-[#D4AF37]/20 hover:border-[#00F0FF]/50 transition-colors shadow-[0_4px_20px_rgba(0,0,0,0.5)] group">
              {/* Corner Brackets */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-[#D4AF37]"></div>
              <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-[#D4AF37]"></div>
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-[#D4AF37]"></div>
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-[#D4AF37]"></div>
              
              <h3 className="text-xl font-bold mb-4 text-[#00F0FF] tracking-wider uppercase group-hover:text-white transition-colors">{feature.title}</h3>
              <p className="text-[#888] font-sans text-sm leading-relaxed">
                {feature.desc}
              </p>
            </div>
          ))}
        </section>

        <section className="bg-[#0a1520] border-y border-[#00F0FF]/30 p-12 text-center my-24 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#00F0FF] to-transparent"></div>
          <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#00F0FF] to-transparent"></div>
          
          <h2 className="text-3xl font-bold mb-4 tracking-widest text-white uppercase">Try the Browser Extension</h2>
          <p className="text-lg text-[#00F0FF]/70 mb-8 font-sans">
            Experience the thermodynamic vMMU directly in Claude.ai or ChatGPT. Completely local and zero-friction.
          </p>
          <a href="https://github.com/sulcus-labs/sulcus/tree/main/packages/sulcus-extension" className="inline-block bg-transparent border border-[#00F0FF] text-[#00F0FF] px-8 py-3 font-bold hover:bg-[#00F0FF] hover:text-[#050a0f] transition-all tracking-widest shadow-[0_0_15px_rgba(0,240,255,0.2)]">
            VIEW SOURCE
          </a>
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