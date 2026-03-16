'use client';

import Link from 'next/link';
import { TbArrowLeft, TbBolt, TbBrain, TbCode, TbFlame } from 'react-icons/tb';

export default function DeepAgentsArticle() {
  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed]">
      <div className="max-w-3xl mx-auto px-6 py-16 font-sans">
        {/* Back link */}
        <Link href="/articles" className="text-[#00F0FF]/60 hover:text-[#00F0FF] text-sm flex items-center gap-1 mb-8">
          <TbArrowLeft size={14} /> Articles
        </Link>

        {/* Header */}
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Deep Agents: The Harness That Forgot to Remember
        </h1>
        <p className="text-sm text-[#888] mb-8">
          LangChain&apos;s Deep Agents SDK ships with planning, filesystems, and subagents. Memory is an afterthought.
          Here&apos;s what that costs you — and how to fix it.
        </p>
        <div className="border-b border-[#D4AF37]/20 mb-10" />

        {/* Body */}
        <article className="prose prose-invert prose-sm max-w-none space-y-6 text-[#ccc] leading-relaxed">
          <h2 className="text-xl font-bold text-[#ededed] mt-8">What Deep Agents Gets Right</h2>
          <p>
            Credit where it&apos;s due: <code>create_deep_agent()</code> is a genuinely good abstraction.
            You get a composable middleware stack — planning (write_todos), filesystem tools (read/write/edit),
            shell access, subagent spawning — all wired into a LangGraph runtime with streaming and checkpointing.
            It&apos;s Claude Code as a library. MIT licensed. Provider-agnostic.
          </p>
          <p>
            The middleware pattern is elegant. Each layer wraps the agent call, can inject system prompts,
            add tools, or transform state. TodoListMiddleware, FilesystemMiddleware, SubAgentMiddleware,
            SummarizationMiddleware — they compose cleanly. You can swap backends between in-memory state,
            local disk, or sandboxed environments. For coding tasks, this is exactly right.
          </p>

          <h2 className="text-xl font-bold text-[#ededed] mt-8">The Memory Problem Nobody Talks About</h2>
          <p>
            Deep Agents&apos; &ldquo;memory&rdquo; is a <code>MemoryMiddleware</code> that loads AGENTS.md files
            from disk and stuffs them into the system prompt. The agent &ldquo;learns&rdquo; by calling <code>edit_file</code>
            to rewrite its own instruction files. That&apos;s the entire memory architecture.
          </p>
          <p>
            Think about what this means in practice:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Every memory is equally important.</strong> A preference from six months ago occupies the same
            context space as a critical decision from five minutes ago. No prioritization. No decay.</li>
            <li><strong>Context grows monotonically.</strong> The AGENTS.md file only gets bigger. Their answer
            is SummarizationMiddleware — which compacts old messages by having an LLM summarize them. That&apos;s
            lossy compression masquerading as memory management.</li>
            <li><strong>No cross-session persistence beyond files.</strong> If the agent rewrites its AGENTS.md,
            it &ldquo;remembers.&rdquo; If it doesn&apos;t, it forgets. There&apos;s no retrieval, no search,
            no relevance scoring. Just grep.</li>
            <li><strong>No multi-agent awareness.</strong> Two subagents spawned by the same Deep Agent
            have no shared memory model. They communicate through files, not through a memory mesh.</li>
          </ul>

          <p>
            This isn&apos;t a criticism of LangChain&apos;s engineering. It&apos;s a criticism of an industry-wide
            assumption: that memory is a solved problem if you can read and write files. It isn&apos;t.
          </p>

          <h2 className="text-xl font-bold text-[#ededed] mt-8">The Flat-File Fallacy</h2>
          <p>
            Every major agent framework does some version of this. CrewAI has short-term, long-term, entity,
            and &ldquo;external&rdquo; memory — which sounds sophisticated until you realize it&apos;s vector
            embeddings plus recency weighting. Vercel AI SDK punts entirely: memory is &ldquo;bring your own database.&rdquo;
            AutoGen uses chat history. LlamaIndex uses RAG.
          </p>
          <p>
            The common thread: everyone treats memory as a <em>retrieval problem</em>. Store things. Search things.
            Return the top-k results. Add a recency bias if you&apos;re feeling fancy.
          </p>
          <p>
            But memory isn&apos;t retrieval. Memory is a <em>thermodynamic system</em>. Things heat up when they&apos;re
            used. They cool down when they&apos;re not. Connections between memories amplify or dampen each other.
            Some memories crystallize into permanent knowledge. Others decay naturally. The system has <em>physics</em>,
            not just a search index.
          </p>

          <h2 className="text-xl font-bold text-[#ededed] mt-8">What Thermodynamic Memory Changes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
            <div className="bg-[#0a1520] border border-[#D4AF37]/20 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbFlame className="text-[#D4AF37]" size={18} />
                <h3 className="text-sm font-bold text-[#D4AF37]">Heat-Based Decay</h3>
              </div>
              <p className="text-xs text-[#999]">
                Each memory type has its own half-life. Episodic memories cool in hours. Semantic knowledge
                persists for months. Preferences are nearly permanent. The system forgets gracefully instead
                of accumulating noise.
              </p>
            </div>
            <div className="bg-[#0a1520] border border-[#D4AF37]/20 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbBolt className="text-[#00F0FF]" size={18} />
                <h3 className="text-sm font-bold text-[#00F0FF]">Resonance Diffusion</h3>
              </div>
              <p className="text-xs text-[#999]">
                When you access a memory, heat spreads to connected memories through edges. Recall one
                fact and related facts warm up automatically. This is associative recall, not keyword search.
              </p>
            </div>
            <div className="bg-[#0a1520] border border-[#D4AF37]/20 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbBrain className="text-[#a855f7]" size={18} />
                <h3 className="text-sm font-bold text-[#a855f7]">Spaced Repetition</h3>
              </div>
              <p className="text-xs text-[#999]">
                Memories accessed repeatedly become more stable. Each recall multiplies stability,
                stretching the effective half-life. Frequently-used knowledge becomes harder to forget —
                just like biological memory.
              </p>
            </div>
            <div className="bg-[#0a1520] border border-[#D4AF37]/20 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbCode className="text-[#22c55e]" size={18} />
                <h3 className="text-sm font-bold text-[#22c55e]">Agent-Aware Context</h3>
              </div>
              <p className="text-xs text-[#999]">
                Memories carry agent IDs, session IDs, and project scope. Multiple agents share
                a memory mesh with controlled visibility — not a flat file that everyone overwrites.
              </p>
            </div>
          </div>

          <h2 className="text-xl font-bold text-[#ededed] mt-8">Integrating Sulcus with Deep Agents</h2>
          <p>
            The integration is a drop-in middleware replacement. Instead of loading AGENTS.md files,
            <code>SulcusMiddleware</code> calls the Sulcus API to build a thermodynamically-weighted
            context block — the hottest, most relevant memories for <em>this specific conversation</em>.
          </p>
          <pre className="bg-[#0a1520] border border-[#333] rounded-lg p-4 text-xs overflow-x-auto">
{`from deepagents import create_deep_agent
from sulcus.langchain import SulcusMiddleware

agent = create_deep_agent(
    middleware=[
        SulcusMiddleware(
            api_key="sk-...",
            agent_id="researcher",
            # Memories decay, resonate, and consolidate
            # automatically. No file management needed.
        )
    ],
    system_prompt="You are a research assistant.",
)

# The agent now has persistent, cross-session,
# thermodynamic memory — not flat files.
result = agent.invoke({
    "messages": [{"role": "user", "content": "Continue the analysis"}]
})`}
          </pre>
          <p>
            What changes for the agent:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Memory persists across sessions without the agent managing files</li>
            <li>Context is prioritized by heat — recent, frequently-accessed memories surface first</li>
            <li>Subagents can share a memory mesh with controlled visibility per project</li>
            <li>The feedback loop (relevant/irrelevant/outdated signals) tunes recall quality over time</li>
            <li>No more context overflow from growing AGENTS.md files — the token budget is managed thermodynamically</li>
          </ul>

          <div className="border-t border-[#D4AF37]/20 mt-10 pt-6">
            <p className="text-sm text-[#888]">
              Deep Agents is a well-built harness. Sulcus is the memory it was designed to plug into.
              Together, they turn a capable coding agent into one that actually <em>remembers</em>.
            </p>
            <div className="flex gap-4 mt-4">
              <Link href="/docs" className="text-sm text-[#00F0FF] hover:underline">SDK Documentation →</Link>
              <a href="https://github.com/digitalforgeca/sulcus" className="text-sm text-[#00F0FF] hover:underline" target="_blank" rel="noopener">GitHub →</a>
              <a href="https://www.npmjs.com/package/sulcus" className="text-sm text-[#00F0FF] hover:underline" target="_blank" rel="noopener">npm →</a>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
