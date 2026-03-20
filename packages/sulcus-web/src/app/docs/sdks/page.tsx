"use client";

import Link from "next/link";
import { TbBrandPython, TbBrandNpm, TbTerminal, TbBrandReact, TbPlugConnected, TbRobot, TbBrain, TbUsers } from "react-icons/tb";

const SDK_REPOS = [
  {
    name: "Python SDK",
    pkg: "sulcus",
    install: "pip install sulcus",
    repo: "https://github.com/digitalforgeca/sulcus-python",
    registry: "https://pypi.org/project/sulcus/",
    icon: <TbBrandPython size={20} />,
    desc: "Core Python client. Store, search, and manage thermodynamic memories. Works with any Python framework.",
    color: "#3776AB",
  },
  {
    name: "Node.js SDK",
    pkg: "sulcus",
    install: "npm install sulcus",
    repo: "https://github.com/digitalforgeca/sulcus-node",
    registry: "https://www.npmjs.com/package/sulcus",
    icon: <TbBrandNpm size={20} />,
    desc: "Core Node.js/TypeScript client. Full API coverage with TypeScript types.",
    color: "#CB3837",
  },
  {
    name: "CLI",
    pkg: "sulcus-cli",
    install: "npm install -g sulcus-cli",
    repo: "https://github.com/digitalforgeca/sulcus-cli",
    registry: "https://www.npmjs.com/package/sulcus-cli",
    icon: <TbTerminal size={20} />,
    desc: "Command-line interface. Manage memories, triggers, and config from your terminal.",
    color: "#50FA7B",
  },
  {
    name: "Vercel AI SDK",
    pkg: "sulcus-vercel-ai",
    install: "npm install sulcus-vercel-ai",
    repo: "https://github.com/digitalforgeca/sulcus-vercel-ai",
    registry: "https://www.npmjs.com/package/sulcus-vercel-ai",
    icon: <TbBrandReact size={20} />,
    desc: "Drop-in memory provider for the Vercel AI SDK. Add persistent memory to any AI app.",
    color: "#00F0FF",
  },
  {
    name: "LangChain",
    pkg: "sulcus-langchain",
    install: "pip install sulcus-langchain",
    repo: "https://github.com/digitalforgeca/sulcus-langchain",
    registry: "https://pypi.org/project/sulcus-langchain/",
    icon: <TbPlugConnected size={20} />,
    desc: "LangChain memory integration. Drop-in replacement for ConversationBufferMemory with thermodynamic decay.",
    color: "#D4AF37",
  },
  {
    name: "LlamaIndex",
    pkg: "sulcus-llamaindex",
    install: "pip install sulcus-llamaindex",
    repo: "https://github.com/digitalforgeca/sulcus-llamaindex",
    registry: "https://pypi.org/project/sulcus-llamaindex/",
    icon: <TbBrain size={20} />,
    desc: "LlamaIndex storage integration. Use Sulcus as a persistent memory store in your RAG pipelines.",
    color: "#BD93F9",
  },
  {
    name: "CrewAI",
    pkg: "sulcus-crewai",
    install: "pip install sulcus-crewai",
    repo: "https://github.com/digitalforgeca/sulcus-crewai",
    registry: "https://pypi.org/project/sulcus-crewai/",
    icon: <TbUsers size={20} />,
    desc: "CrewAI memory backend. Give your crew persistent cross-agent memory with thermodynamic decay.",
    color: "#FF6B6B",
  },
  {
    name: "DeepAgents",
    pkg: "sulcus-deepagents",
    install: "pip install sulcus-deepagents",
    repo: "https://github.com/digitalforgeca/sulcus-deepagents",
    registry: "https://pypi.org/project/sulcus-deepagents/",
    icon: <TbRobot size={20} />,
    desc: "DeepAgents integration. Thermodynamic memory for deep agent orchestration frameworks.",
    color: "#FFB86C",
  },
];

export default function SdksPage() {
  return (
    <div className="max-w-4xl mx-auto py-16 px-6 font-mono text-[#ededed]">
      <h1 className="text-3xl font-bold tracking-widest text-[#D4AF37] uppercase mb-2">SDKs &amp; Integrations</h1>
      <p className="text-sm text-[#888] mb-12">
        Sulcus is API-first. All SDKs are open-source HTTP clients — they talk to the Sulcus Cloud API or your self-hosted instance. No proprietary code is distributed.
      </p>

      {/* Quick install */}
      <div className="mb-12 border border-[#D4AF37]/20 p-6 bg-[#0a1520]/50">
        <h2 className="text-sm font-bold tracking-widest text-[#00F0FF] uppercase mb-4">Quick Start</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] text-[#666] uppercase tracking-widest mb-1">Python</p>
            <code className="text-xs text-[#50FA7B] bg-[#050a0f] px-3 py-2 block border border-[#333]">pip install sulcus</code>
          </div>
          <div>
            <p className="text-[10px] text-[#666] uppercase tracking-widest mb-1">Node.js / TypeScript</p>
            <code className="text-xs text-[#50FA7B] bg-[#050a0f] px-3 py-2 block border border-[#333]">npm install sulcus</code>
          </div>
        </div>
      </div>

      {/* SDK cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SDK_REPOS.map((sdk) => (
          <div key={sdk.pkg} className="border border-[#D4AF37]/10 p-5 hover:border-[#D4AF37]/30 transition-colors bg-[#0a1520]/30">
            <div className="flex items-center gap-3 mb-3">
              <span style={{ color: sdk.color }}>{sdk.icon}</span>
              <h3 className="text-sm font-bold tracking-widest uppercase" style={{ color: sdk.color }}>{sdk.name}</h3>
            </div>
            <p className="text-xs text-[#888] mb-4 leading-relaxed">{sdk.desc}</p>
            <code className="text-[10px] text-[#50FA7B] bg-[#050a0f] px-2 py-1 border border-[#333] block mb-4">{sdk.install}</code>
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

      {/* API reference note */}
      <div className="mt-12 border-t border-[#D4AF37]/10 pt-8">
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
