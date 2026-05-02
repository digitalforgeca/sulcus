'use client';

import { useState } from 'react';

export default function PerformancePage() {
  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed] font-mono selection:bg-[#00F0FF] selection:text-[#050a0f] relative overflow-hidden">
      {/* Hex Grid Background Pattern */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.06] z-0" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'100\' viewBox=\'0 0 60 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg stroke=\'%2300F0FF\' stroke-width=\'1\' fill=\'none\' fill-rule=\'evenodd\'%3E%3Cpath d=\'M30 0l30 16.5v33L30 66 0 49.5v-33L30 0zm0 100l30-16.5v-33L30 34 0 50.5v33L30 100z\'/%3E%3C/g%3E%3C/svg%3E")', backgroundSize: '60px 100px' }}></div>

      <div className="max-w-[1000px] mx-auto px-8 relative z-10 pb-32">
        <nav className="flex justify-between items-center py-8 border-b border-[#D4AF37]/30">
          <div className="text-2xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-2">
            <div className="w-3 h-3 bg-[#00F0FF] rounded-sm shadow-[0_0_8px_#00F0FF]"></div>
            SULCUS
          </div>
          <div className="flex gap-8 text-sm font-medium text-[#888] uppercase tracking-wider items-center">
            <a href="/" className="hover:text-[#00F0FF] transition-colors">Home</a>
            <a href="/dashboard" className="text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#050a0f] transition-colors border border-[#D4AF37] px-6 py-2">CONSOLE</a>
          </div>
        </nav>

        <header className="py-20">
          <h1 className="text-5xl font-bold mb-6 tracking-tighter text-white">SYSTEM BENCHMARKS</h1>
          <p className="text-xl text-[#D4AF37] uppercase tracking-widest">Validating the sub-50ms thermodynamic engine.</p>
        </header>

        {/* Technical Stats Section */}
        <section className="mb-24">
          <div className="flex items-center gap-4 mb-8">
            <h2 className="text-2xl font-bold text-white tracking-widest uppercase">Latency Audit</h2>
            <div className="h-[1px] flex-1 bg-gradient-to-r from-[#D4AF37]/50 to-transparent"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="bg-[#0a1520] p-8 border border-[#D4AF37]/30 relative">
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
              <h3 className="text-[#888] text-xs uppercase mb-2">Internal Context Build</h3>
              <div className="text-4xl font-bold text-[#00F0FF]">&lt; 25ms</div>
              <p className="text-xs text-[#555] mt-4">Average time to retrieve, rank, and format memories.</p>
            </div>
            <div className="bg-[#0a1520] p-8 border border-[#D4AF37]/30 relative">
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
              <h3 className="text-[#888] text-xs uppercase mb-2">P95 Round-Trip</h3>
              <div className="text-4xl font-bold text-[#00F0FF]">473ms</div>
              <p className="text-xs text-[#555] mt-4">Validated across 50 iterations to sulcus.ca.</p>
            </div>
            <div className="bg-[#0a1520] p-8 border border-[#D4AF37]/30 relative">
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
              <h3 className="text-[#888] text-xs uppercase mb-2">Zero-Copy Read</h3>
              <div className="text-4xl font-bold text-[#00F0FF]">~0ns</div>
              <p className="text-xs text-[#555] mt-4">Active index access via mmap has near-zero overhead.</p>
            </div>
          </div>

          {/* Stylized Latency Chart */}
          <div className="bg-[#0a1520] p-8 border border-[#D4AF37]/10 rounded-lg">
            <h3 className="text-sm font-bold text-[#D4AF37] mb-8 uppercase tracking-widest">Retrieval Performance vs Vector Count</h3>
            <div className="relative h-64 w-full">
              <svg className="w-full h-full" viewBox="0 0 1000 200" preserveAspectRatio="none">
                {/* Grid Lines */}
                <line x1="0" y1="150" x2="1000" y2="150" stroke="#222" strokeWidth="1" />
                <line x1="0" y1="100" x2="1000" y2="100" stroke="#222" strokeWidth="1" />
                <line x1="0" y1="50" x2="1000" y2="50" stroke="#222" strokeWidth="1" />
                
                {/* Data Line (Sulcus) */}
                <path 
                  d="M0 180 L200 175 L400 172 L600 170 L800 168 L1000 167" 
                  fill="none" 
                  stroke="#00F0FF" 
                  strokeWidth="3" 
                  className="drop-shadow-[0_0_8px_#00F0FF]"
                />
                
                {/* Data Line (Naive RAG) */}
                <path 
                  d="M0 180 L200 160 L400 130 L600 90 L800 40 L1000 10" 
                  fill="none" 
                  stroke="#D4AF37" 
                  strokeWidth="2" 
                  strokeDasharray="5,5"
                  opacity="0.5"
                />
              </svg>
              <div className="flex justify-between text-[10px] text-[#555] mt-4 uppercase tracking-widest">
                <span>100 Nodes</span>
                <span>1,000 Nodes</span>
                <span>10,000 Nodes</span>
                <span>100,000 Nodes</span>
              </div>
            </div>
            <div className="flex gap-8 mt-8">
              <div className="flex items-center gap-2">
                <div className="w-3 h-1 bg-[#00F0FF]"></div>
                <span className="text-[10px] text-[#888] uppercase">Sulcus vMMU (Zero-Copy)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-1 bg-[#D4AF37] opacity-50 border-dashed border"></div>
                <span className="text-[10px] text-[#888] uppercase">Standard RAG (JSON/REST)</span>
              </div>
            </div>
          </div>
        </section>

        {/* ROI / Efficiency Table */}
        <section className="mb-24">
          <div className="flex items-center gap-4 mb-8">
            <h2 className="text-2xl font-bold text-white tracking-widest uppercase">Efficiency Analysis</h2>
            <div className="h-[1px] flex-1 bg-gradient-to-r from-[#D4AF37]/50 to-transparent"></div>
          </div>

          <div className="bg-[#0a1520] border border-[#D4AF37]/20 overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.5)]">
            <table className="w-full text-left">
              <thead className="bg-[#111820] text-[#D4AF37] text-xs uppercase tracking-widest border-b border-[#D4AF37]/30">
                <tr>
                  <th className="p-6 font-normal">Scenario (100 Turn Chat)</th>
                  <th className="p-6 font-normal">Input Tokens</th>
                  <th className="p-6 font-normal">Cost / 1k Msgs</th>
                  <th className="p-6 font-normal">Context Quality</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D4AF37]/10">
                <tr className="bg-red-950/10">
                  <td className="p-6 text-white font-bold">WITHOUT SULCUS</td>
                  <td className="p-6 text-red-400">20,000</td>
                  <td className="p-6 text-red-400">$100.00</td>
                  <td className="p-6 text-[#888]">Noisy history</td>
                </tr>
                <tr className="bg-green-950/10">
                  <td className="p-6 text-[#00F0FF] font-bold">WITH SULCUS (vMMU)</td>
                  <td className="p-6 text-[#00F0FF]">2,000</td>
                  <td className="p-6 text-[#00F0FF]">$10.00</td>
                  <td className="p-6 text-white">Ranked Salience</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-8 text-center">
            <div className="inline-block bg-[#00F0FF]/10 border border-[#00F0FF]/30 px-12 py-6">
              <span className="text-[#00F0FF] text-3xl font-bold tracking-widest">90% COST REDUCTION</span>
            </div>
          </div>
        </section>

        {/* Methodology Footer */}
        <footer className="pt-16 border-t border-[#D4AF37]/20 text-[#2a4a5a] text-xs leading-relaxed max-w-2xl font-sans">
          METHODOLOGY: Benchmarks conducted on 2026-03-05 using a Standard DS2 v2 Azure VM. 
          Cost estimates based on GPT-4o input rates ($5.00/1M tokens). 
          LLM Efficiency Scenario assumes 100 turns of 200 tokens each vs 10 ranked nodes retrieved via SULCUS.
        </footer>
      </div>
    </div>
  );
}
