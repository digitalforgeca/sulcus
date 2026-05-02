"use client";

import Link from "next/link";
import { TbBrandPython, TbBrandNpm, TbPlugConnected, TbApi, TbBrandReact, TbRobot, TbBrain, TbUsers, TbTerminal } from "react-icons/tb";

const AVAILABLE_SDKS = [
  {
    name: "Node.js SDK",
    pkg: "@digitalforgestudios/sulcus",
    install: "npm install @digitalforgestudios/sulcus",
    version: "v0.7.1",
    repo: "https://github.com/digitalforgeca/sulcus",
    registry: "https://www.npmjs.com/package/@digitalforgestudios/sulcus",
    icon: <TbBrandNpm size={20} />,
    desc: "Core Node.js/TypeScript client. Full API coverage with TypeScript types. Store, search, and manage thermodynamic memories.",
    color: "#CB3837",
    status: "available",
  },
  {
    name: "OpenClaw Plugin",
    pkg: "@digitalforgestudios/openclaw-sulcus",
    install: "openclaw plugin install @digitalforgestudios/openclaw-sulcus",
    version: "v3.11.1",
    repo: "https://github.com/digitalforgeca/sulcus",
    registry: "https://www.npmjs.com/package/@digitalforgestudios/openclaw-sulcus",
    icon: <TbPlugConnected size={20} />,
    desc: "Drop-in memory backend for OpenClaw agents. Auto-recall, auto-capture, heat decay, SIU v2 pipeline integration, and cross-agent sync.",
    color: "#00F0FF",
    status: "available",
  },
  {
    name: "Python SDK",
    pkg: "sulcus",
    install: "pip install sulcus",
    version: "",
    repo: "https://github.com/digitalforgeca/sulcus",
    registry: "https://pypi.org/project/sulcus/",
    icon: <TbBrandPython size={20} />,
    desc: "Core Python client. Store, search, and manage thermodynamic memories. Works with any Python framework.",
    color: "#3776AB",
    status: "available",
  },
  {
    name: "REST API",
    pkg: "curl / fetch / httpx",
    install: 'curl -H "Authorization: Bearer $KEY" https://api.sulcus.ca/api/v1/agent/nodes',
    version: "v2.2.1 server",
    repo: "https://github.com/digitalforgeca/sulcus",
    registry: "https://api.sulcus.ca/api/v1/status",
    icon: <TbApi size={20} />,
    desc: "Direct HTTP API. Works with any language or tool. All SDKs are thin wrappers over this API. Server v2.2.1 — 32 modules, ~50 endpoints, AGE knowledge graph, interaction-based decay, curator system.",
    color: "#50FA7B",
    status: "available",
  },
];

const PLANNED_INTEGRATIONS = [
  { name: "LangChain", desc: "SulcusMemory + retriever integration", icon: <TbPlugConnected size={16} />, color: "#D4AF37" },
  { name: "LlamaIndex", desc: "Memory store + query engine", icon: <TbBrain size={16} />, color: "#BD93F9" },
  { name: "Vercel AI SDK", desc: "LanguageModelV3Middleware for automatic memory", icon: <TbBrandReact size={16} />, color: "#00F0FF" },
  { name: "CrewAI", desc: "Shared reactive, thermodynamic memory for multi-agent crews", icon: <TbUsers size={16} />, color: "#FF6B6B" },
  { name: "CLI", desc: "Terminal interface: search, store, list, pin, forget", icon: <TbTerminal size={16} />, color: "#50FA7B" },
];

export default function SdksClient() {
  return (
    <div className="max-w-4xl mx-auto py-16 px-6 font-mono text-[#ededed]">
      <h1 className="text-3xl font-bold tracking-widest text-[#D4AF37] uppercase mb-2">SDKs &amp; Integrations</h1>
      <p className="text-sm text-[#888] mb-12">
        Sulcus is API-first. All SDKs are open-source HTTP clients — they talk to the Sulcus Cloud API or your self-hosted instance.
      </p>

      {/* Quick install */}
      <div className="mb-12 border border-[#D4AF37]/20 p-6 bg-[#0a1520]/50">
        <h2 className="text-sm font-bold tracking-widest text-[#00F0FF] uppercase mb-4">Quick Start</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] text-[#666] uppercase tracking-widest mb-1">Node.js / TypeScript</p>
            <code className="text-xs text-[#50FA7B] bg-[#050a0f] px-3 py-2 block border border-[#333]">npm install @digitalforgestudios/sulcus</code>
          </div>
          <div>
            <p className="text-[10px] text-[#666] uppercase tracking-widest mb-1">OpenClaw Plugin</p>
            <code className="text-xs text-[#50FA7B] bg-[#050a0f] px-3 py-2 block border border-[#333]">openclaw plugin install @digitalforgestudios/openclaw-sulcus</code>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <p className="text-[10px] text-[#666] uppercase tracking-widest mb-1">Python</p>
            <code className="text-xs text-[#50FA7B] bg-[#050a0f] px-3 py-2 block border border-[#333]">pip install sulcus</code>
          </div>
          <div>
            <p className="text-[10px] text-[#666] uppercase tracking-widest mb-1">REST API</p>
            <code className="text-xs text-[#50FA7B] bg-[#050a0f] px-3 py-2 block border border-[#333]">curl -H &quot;Authorization: Bearer $KEY&quot; api.sulcus.ca/api/v1/agent/nodes</code>
          </div>
        </div>
      </div>

      {/* Available SDK cards */}
      <h2 className="text-sm font-bold tracking-widest text-[#D4AF37] uppercase mb-4">Available Now</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
        {AVAILABLE_SDKS.map((sdk) => (
          <div key={sdk.pkg} className="border border-[#D4AF37]/10 p-5 hover:border-[#D4AF37]/30 transition-colors bg-[#0a1520]/30">
            <div className="flex items-center gap-3 mb-3">
              <span style={{ color: sdk.color }}>{sdk.icon}</span>
              <h3 className="text-sm font-bold tracking-widest uppercase" style={{ color: sdk.color }}>{sdk.name}</h3>
              {sdk.version && (
                <span className="text-[10px] text-[#555] border border-[#333] px-1.5 py-0.5 rounded font-mono">{sdk.version}</span>
              )}
            </div>
            <p className="text-xs text-[#888] mb-4 leading-relaxed">{sdk.desc}</p>
            <code className="text-[10px] text-[#50FA7B] bg-[#050a0f] px-2 py-1 border border-[#333] block mb-4 break-all">{sdk.install}</code>
            <div className="flex items-center gap-4 text-[10px] uppercase tracking-widest">
              <a href={sdk.repo} target="_blank" rel="noopener noreferrer" className="text-[#00F0FF] hover:text-[#00F0FF]/70 transition-colors">
                GitHub →
              </a>
              <a href={sdk.registry} target="_blank" rel="noopener noreferrer" className="text-[#888] hover:text-[#ededed] transition-colors">
                Registry →
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Planned integrations */}
      <h2 className="text-sm font-bold tracking-widest text-[#888] uppercase mb-4">Coming Soon</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-12">
        {PLANNED_INTEGRATIONS.map((int) => (
          <div key={int.name} className="border border-[#333]/50 p-4 bg-[#0a1520]/20 opacity-60">
            <div className="flex items-center gap-2 mb-2">
              <span style={{ color: int.color }}>{int.icon}</span>
              <h3 className="text-xs font-bold tracking-widest uppercase text-[#888]">{int.name}</h3>
            </div>
            <p className="text-[10px] text-[#555] leading-relaxed">{int.desc}</p>
          </div>
        ))}
      </div>

      {/* API reference note */}
      <div className="border-t border-[#D4AF37]/10 pt-8">
        <h2 className="text-sm font-bold tracking-widest text-[#D4AF37] uppercase mb-4">API Reference</h2>
        <p className="text-xs text-[#888] leading-relaxed mb-4">
          All SDKs are thin HTTP clients over the Sulcus REST API. You can also call the API directly:
        </p>
        <code className="text-xs text-[#50FA7B] bg-[#050a0f] px-3 py-2 border border-[#333] block mb-4">
          curl -H &quot;Authorization: Bearer YOUR_API_KEY&quot; https://api.sulcus.ca/api/v1/agent/nodes
        </code>
        <p className="text-xs text-[#888] leading-relaxed">
          See the <Link href="/docs" className="text-[#00F0FF] hover:underline">full documentation</Link> for API endpoints, authentication, and configuration.
        </p>
      </div>
    </div>
  );
}
