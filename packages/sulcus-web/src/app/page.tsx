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
    <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] font-sans selection:bg-[#ff3e00] selection:text-white">
      <div className="max-w-[1000px] mx-auto px-8">
        <nav className="flex justify-between items-center py-8">
          <div className="text-2xl font-bold tracking-tighter">SULCUS</div>
          <div className="flex gap-8 text-sm font-medium text-[#888]">
            <a href="https://github.com/google/sulcus" className="hover:text-white transition-colors">GitHub Docs</a>
            <a href="/dashboard" className="hover:text-white transition-colors border border-[#333] px-4 py-1 rounded-full">SaaS Login</a>
          </div>
        </nav>
        <header className="text-center py-16 md:py-32">
          <h1 className="text-6xl md:text-8xl font-bold mb-4 tracking-tighter">
            SULCUS
          </h1>
          <p className="text-xl md:text-2xl text-[#888] mb-8">
            The Virtual Memory Management Unit for AI Agents.
          </p>
          <p className="text-lg mb-12 max-w-2xl mx-auto">
            Stop burning tokens on history. Give your agent a mind that pages.
          </p>
          
          {joined ? (
            <div className="bg-[#111] border border-[#ff3e00]/30 text-[#ff3e00] px-8 py-4 rounded font-bold inline-block animate-pulse">
              Welcome to the fleet. We'll be in touch.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-12 max-w-md mx-auto flex gap-2">
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email" 
                className="flex-1 bg-[#111] border border-[#333] px-4 py-3 rounded focus:border-[#ff3e00] outline-none transition-colors text-white"
                required
              />
              <button
                type="submit"
                className="bg-[#ff3e00] text-white px-6 py-3 rounded font-bold hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                Join Waitlist
              </button>
            </form>
          )}
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-8 my-16">
          <div className="bg-[#222] p-8 rounded-lg border border-[#333]">
            <h3 className="text-xl font-bold mb-4">Thermodynamic Memory</h3>
            <p className="text-[#888]">
              Knowledge graph nodes that gain <code className="bg-black px-1 py-0.5 rounded text-[#ff3e00]">heat</code> on use and <code className="bg-black px-1 py-0.5 rounded text-[#ff3e00]">decay</code> over time. Autonomous context management.
            </p>
          </div>
          <div className="bg-[#222] p-8 rounded-lg border border-[#333]">
            <h3 className="text-xl font-bold mb-4">Rust + Postgres</h3>
            <p className="text-[#888]">
              Sub-50ms context builds. High performance local persistence via an embedded PG15 instance.
            </p>
          </div>
          <div className="bg-[#222] p-8 rounded-lg border border-[#333]">
            <h3 className="text-xl font-bold mb-4">Zero-Copy Hot Path</h3>
            <p className="text-[#888]">
              Mapped memory shared index. No serialization overhead between the vMMU and your agent runtime.
            </p>
          </div>
        </section>

        <h2 className="text-4xl font-bold text-center mt-32 mb-16 tracking-tight">Pricing</h2>
        
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center mb-32">
          <div className="text-center p-12 border border-[#333] rounded-lg">
            <h3 className="text-2xl font-bold">Sulcus Open</h3>
            <div className="text-5xl font-bold my-4">$0</div>
            <ul className="text-[#888] space-y-2 mt-8">
              <li>MIT Licensed Core</li>
              <li>Local PGlite Backend</li>
              <li>Standard MCP Support</li>
            </ul>
          </div>
          
          <div className="text-center p-12 border-2 border-[#ff3e00] rounded-lg bg-[#111] scale-105 z-10">
            <div className="bg-[#ff3e00] text-white text-xs font-bold uppercase py-1 px-3 rounded-full inline-block mb-4">Recommended</div>
            <h3 className="text-2xl font-bold">Sulcus Pro</h3>
            <div className="text-5xl font-bold my-4">$49<span className="text-xl font-normal text-[#888]">/mo</span></div>
            <ul className="text-[#888] space-y-2 mt-8">
              <li>Desktop Sidecar App</li>
              <li>Advanced Heat Diffusion</li>
              <li>Priority Support</li>
              <li>Cloud Sync</li>
            </ul>
          </div>

          <div className="text-center p-12 border border-[#333] rounded-lg">
            <h3 className="text-2xl font-bold">Enterprise</h3>
            <div className="text-5xl font-bold my-4">Custom</div>
            <ul className="text-[#888] space-y-2 mt-8">
              <li>Multi-tenant Server</li>
              <li>Distributed Vector Cache</li>
              <li>SOC2 / Private Cloud</li>
              <li>SSO Integration</li>
            </ul>
          </div>
        </section>

        <footer className="text-center py-16 border-t border-[#222] text-[#555]">
          Built with Rust and 🦀 for the agentic future.
        </footer>
      </div>
    </div>
  );
}
