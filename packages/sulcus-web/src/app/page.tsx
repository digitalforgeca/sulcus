'use client';

import { useState, useEffect } from 'react';

interface Price {
  unit_amount: number;
}

export default function Home() {
  const [email, setEmail] = useState('');
  const [joined, setJoined] = useState(false);
  const [cortexPrice, setCortexPrice] = useState('$299.00');

  useEffect(() => {
    async function loadPrice() {
      try {
        const serverUrl = process.env.NEXT_PUBLIC_SULCUS_SERVER_URL || 'https://sulcus.dforge.ca';
        const res = await fetch(`${serverUrl}/api/v1/billing/products`);
        if (res.ok) {
          const data = await res.json();
          const prices = data.prices?.data || [];
          const cortex = prices.find((p: any) => p.nickname?.toLowerCase().includes('cortex') || p.id === 'price_cortex_monthly');
          if (cortex) {
            setCortexPrice(`$${(cortex.unit_amount / 100).toFixed(2)}`);
          }
        }
      } catch (e) {}
    }
    loadPrice();
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
        <nav className="flex justify-between items-center py-8 border-b border-[#D4AF37]/30">
          <div className="text-2xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-2">
            <div className="w-3 h-3 bg-[#00F0FF] rounded-sm shadow-[0_0_8px_#00F0FF]"></div>
            SULCUS
          </div>
          <div className="flex gap-8 text-sm font-medium text-[#888] uppercase tracking-wider items-center">
            <a href="/performance" className="hover:text-[#00F0FF] transition-colors">Benchmarks</a>
            <a href="https://github.com/digitalforgeca/sulcus" className="hover:text-white transition-colors">GitHub</a>
            <div className="h-4 w-[1px] bg-[#D4AF37]/30"></div>
            <a href="/dashboard" className="hover:text-[#00F0FF] transition-colors">Sign In</a>
            <a href="/dashboard" className="text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#050a0f] transition-colors border border-[#D4AF37] px-6 py-2 shadow-[0_0_10px_rgba(212,175,55,0.2)] inset-shadow">CONSOLE</a>
          </div>
        </nav>
        
        <header className="text-center py-20 md:py-28 relative">
          <div className="flex items-center justify-center mb-8 opacity-50">
            <div className="h-[1px] w-16 bg-gradient-to-l from-[#D4AF37] to-transparent"></div>
            <div className="w-2 h-2 rotate-45 bg-[#00F0FF] mx-4 shadow-[0_0_5px_#00F0FF]"></div>
            <div className="h-[1px] w-16 bg-gradient-to-r from-[#D4AF37] to-transparent"></div>
          </div>

          <h1 className="text-6xl md:text-8xl font-bold mb-4 tracking-tighter text-white" style={{ textShadow: '0 0 30px rgba(0, 240, 255, 0.3)' }}>
            SULCUS
          </h1>
          <p className="text-xl md:text-2xl text-[#D4AF37] mb-8 font-sans tracking-wide uppercase max-w-3xl mx-auto">
            The Supabase for AI Agent Memory.
          </p>

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
            Stop burning tokens on history. SULCUS is a thermodynamic Virtual Memory Management Unit (vMMU) that gives your agents infinite, salient recall while slashing API costs.
          </p>
          
          {joined ? (
            <div className="bg-[#0a1520] border border-[#00F0FF] text-[#00F0FF] px-8 py-4 font-bold inline-block animate-pulse shadow-[0_0_15px_rgba(0,240,255,0.2)]">
              [ STATUS: ENROLLED. REDIRECTING... ]
            </div>
          ) : (
            <div className="mt-12 max-w-md mx-auto">
              <p className="text-xs text-[#888] uppercase tracking-widest mb-3 text-left leading-relaxed">
                Connect your <span className="text-[#D4AF37]">Agent Identifier</span> to start paging thermodynamic context.
              </p>
              <form onSubmit={handleSubmit} className="flex">
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="AGENT EMAIL" 
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
            </div>
          )}
        </header>

        {/* Product Suite Section */}
        <section className="py-24 border-t border-[#D4AF37]/20">
          <h2 className="text-3xl font-bold mb-16 tracking-widest text-[#D4AF37] uppercase text-center">The SULCUS Suite</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            
            <div className="flex flex-col group">
              <div className="text-[#00F0FF] mb-6 flex items-center gap-4">
                <div className="w-10 h-10 border border-[#00F0FF] flex items-center justify-center font-bold">01</div>
                <h3 className="text-xl font-bold tracking-widest uppercase">WASM Core</h3>
              </div>
              <p className="text-sm text-[#888] font-sans leading-relaxed mb-6">
                Our core thermodynamic graph engine, compiled to <span className="text-white">WebAssembly</span>. Enables sub-ms memory operations directly in the browser with 100% data sovereignty. No data egress, just pure local performance.
              </p>
              <div className="mt-auto h-[2px] w-12 bg-[#00F0FF] group-hover:w-full transition-all duration-500"></div>
            </div>

            <div className="flex flex-col group">
              <div className="text-[#D4AF37] mb-6 flex items-center gap-4">
                <div className="w-10 h-10 border border-[#D4AF37] flex items-center justify-center font-bold">02</div>
                <h3 className="text-xl font-bold tracking-widest uppercase">Claude & ChatGPT</h3>
              </div>
              <p className="text-sm text-[#888] font-sans leading-relaxed mb-6">
                A native <span className="text-white">Chrome Extension</span> that injects the vMMU directly into Claude.ai and ChatGPT. It uses the WASM core to manage your conversation context, automatically paging out "cold" turns to save tokens.
              </p>
              <div className="mt-auto h-[2px] w-12 bg-[#D4AF37] group-hover:w-full transition-all duration-500"></div>
            </div>

            <div className="flex flex-col group">
              <div className="text-[#FF6B35] mb-6 flex items-center gap-4">
                <div className="w-10 h-10 border border-[#FF6B35] flex items-center justify-center font-bold">03</div>
                <h3 className="text-xl font-bold tracking-widest uppercase">OpenClaw</h3>
              </div>
              <p className="text-sm text-[#888] font-sans leading-relaxed mb-6">
                Deep integration with the <span className="text-white">OpenClaw</span> ecosystem. Deploy SULCUS as a persistent memory skill or a managed plugin. Sync your agent's mental model across your entire fleet with one command.
              </p>
              <div className="mt-auto h-[2px] w-12 bg-[#FF6B35] group-hover:w-full transition-all duration-500"></div>
            </div>

          </div>
        </section>

        {/* Diagram */}
        <div className="w-full flex flex-col items-center py-20 mb-16 border-y border-[#D4AF37]/20 bg-[#0a1520]/50 relative">
           <h3 className="text-xs tracking-[0.5em] text-[#D4AF37] uppercase mb-12">System Architecture: Zero-Copy Context Build</h3>
           <svg width="800" height="200" viewBox="0 0 800 200" className="max-w-full h-auto">
             <rect x="50" y="70" width="120" height="60" fill="#050a0f" stroke="#D4AF37" strokeWidth="2" />
             <text x="110" y="105" fill="#fff" fontSize="14" fontFamily="monospace" textAnchor="middle" alignmentBaseline="middle">AI AGENT</text>
             
             <path d="M170 100 L250 100" stroke="#00F0FF" strokeWidth="2" strokeDasharray="5,5" />
             <polygon points="240,95 250,100 240,105" fill="#00F0FF" />

             <rect x="250" y="40" width="300" height="120" fill="#0a1520" stroke="#00F0FF" strokeWidth="2" />
             <text x="400" y="60" fill="#00F0FF" fontSize="12" fontFamily="monospace" textAnchor="middle" letterSpacing="0.1em">SULCUS vMMU (THERMODYNAMIC GRAPH)</text>
             
             <circle cx="300" cy="100" r="15" fill="#FF6B35" />
             <circle cx="360" cy="85" r="10" fill="#D4AF37" />
             <circle cx="440" cy="115" r="8" fill="#00F0FF" opacity="0.6" />
             <circle cx="500" cy="90" r="6" fill="#888" opacity="0.3" />
             
             <line x1="315" y1="100" x2="350" y2="85" stroke="#D4AF37" strokeWidth="1" />
             <line x1="370" y1="85" x2="432" y2="115" stroke="#00F0FF" strokeWidth="1" opacity="0.5" />

             <path d="M550 100 L630 100" stroke="#00F0FF" strokeWidth="2" />
             <polygon points="620,95 630,100 620,105" fill="#00F0FF" />
             <text x="590" y="90" fill="#00F0FF" fontSize="10" fontFamily="monospace" textAnchor="middle">↓ 90% Tokens</text>

             <rect x="630" y="70" width="120" height="60" fill="#050a0f" stroke="#D4AF37" strokeWidth="2" />
             <text x="690" y="105" fill="#fff" fontSize="14" fontFamily="monospace" textAnchor="middle" alignmentBaseline="middle">LLM API</text>
           </svg>
        </div>

        <h2 className="text-4xl font-bold text-center mt-32 mb-16 tracking-widest text-[#D4AF37] uppercase">Deployment Protocols</h2>
        
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch mb-32">
          {/* OPEN TIER */}
          <div className="text-center p-10 border border-[#D4AF37]/30 bg-[#0a1520] relative flex flex-col h-full">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-[2px] bg-[#D4AF37]/50"></div>
            <h3 className="text-xl font-bold tracking-widest text-white uppercase">Sulcus Open</h3>
            <div className="text-4xl font-bold my-6 text-[#D4AF37]">$0</div>
            <ul className="text-[#888] space-y-4 mb-10 font-sans text-sm text-left mx-auto">
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#00F0FF]"></div>MIT Licensed Core</li>
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#00F0FF]"></div>Local PGlite Backend</li>
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#00F0FF]"></div>Standard MCP Support</li>
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#00F0FF]"></div>Browser Extension</li>
            </ul>
            <a href="https://github.com/digitalforgeca/sulcus" className="mt-auto inline-block w-full bg-transparent border border-[#D4AF37] text-[#D4AF37] py-3 rounded font-bold hover:bg-[#D4AF37]/10 transition-all tracking-widest uppercase">GET SOURCE</a>
          </div>
          
          {/* CORTEX TIER */}
          <div className="text-center p-12 border border-[#D4AF37] bg-[#0a1520] relative flex flex-col h-full shadow-[0_0_30px_rgba(212,175,55,0.15)] z-10 -mt-4 mb-4">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#D4AF37] text-[#050a0f] text-xs font-bold px-4 py-1 tracking-widest">RECOMMENDED</div>
            <h3 className="text-2xl font-bold tracking-widest text-white mt-4 uppercase">Sulcus Cortex</h3>
            <div className="text-5xl font-bold my-6 text-[#D4AF37]">{cortexPrice}<span className="text-lg text-[#888] font-normal">/mo</span></div>
            <ul className="text-[#ddd] space-y-4 mb-12 font-sans text-sm text-left mx-auto">
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rotate-45 bg-[#D4AF37]"></div>Cloud Sync for Agent Fleets</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rotate-45 bg-[#D4AF37]"></div>Advanced Heat Diffusion</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rotate-45 bg-[#D4AF37]"></div>100GB Storage Limit</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rotate-45 bg-[#D4AF37]"></div>Remote MCP via SSE</li>
            </ul>
            <a href="/dashboard/billing" className="mt-auto inline-block w-full bg-gradient-to-r from-[#D4AF37] to-[#B8860B] text-[#050a0f] py-4 font-bold hover:brightness-110 transition-all tracking-widest uppercase">UPGRADE TO CORTEX</a>
          </div>

          {/* ENTERPRISE TIER */}
          <div className="text-center p-10 border border-[#00F0FF]/40 bg-[#0a1520] relative flex flex-col h-full shadow-[0_0_20px_rgba(0,240,255,0.05)]">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-[2px] bg-[#00F0FF]/50"></div>
            <h3 className="text-xl font-bold tracking-widest text-white uppercase">Enterprise</h3>
            <div className="text-4xl font-bold my-6 text-[#00F0FF]">CUSTOM</div>
            <ul className="text-[#888] space-y-4 mb-10 font-sans text-sm text-left mx-auto">
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#D4AF37]"></div>Multi-tenant Server</li>
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#D4AF37]"></div>Distributed Vector Cache</li>
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#D4AF37]"></div>SOC2 / Private Cloud</li>
              <li className="flex items-center gap-2"><div className="w-1 h-1 bg-[#D4AF37]"></div>SSO Integration</li>
            </ul>
            <a href="mailto:apouriliaee+sulcus@gmail.com" className="mt-auto inline-block w-full bg-transparent border border-[#00F0FF] text-[#00F0FF] py-3 font-bold hover:bg-[#00F0FF]/10 transition-colors tracking-widest uppercase">CONTACT SALES</a>
          </div>
        </section>

        <footer className="text-center py-16 border-t border-[#D4AF37]/20 text-[#2a4a5a] text-sm tracking-[0.2em] font-medium hover:text-[#00F0FF]/50 transition-colors">
          BUILT WITH RUST AND 🦀 FOR THE AGENTIC FUTURE
        </footer>
      </div>
    </div>
  );
}
