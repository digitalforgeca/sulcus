# OpenClaw Fork/Rewrite Analysis
**Date:** 2026-04-29  
**Author:** Sulcus Improvement Cycle — Task 52  
**Context:** Dooley asked (2026-04-29 ~00:04 PT): *"I'm almost considering forking openclaw or another project similar if I'm being honest. I want to explore what we're doing and what we're using to do it."*

---

## The Question

Should we stay on OpenClaw as a plugin host, fork it, or build a thin agent runtime around Sulcus directly? This document gives an honest answer.

---

## What OpenClaw Actually Gives Us

Before evaluating alternatives, let's be specific about what OpenClaw provides that we actually use:

### Things We Use and Would Have to Replicate

| Feature | OpenClaw Gives Us | Effort to Replicate |
|---|---|---|
| **Channel connectors** | Discord, Telegram, Slack, Signal, etc. — maintained, OAuth-managed, battle-tested | Very high — each connector is months of work |
| **LLM routing** | Multi-provider (Anthropic, Azure, OpenAI, Gemini) with unified API | High — wrapping provider SDKs + routing logic |
| **Plugin/extension system** | `registerTool`, `registerMemoryRuntime`, hook lifecycle, config schema, UI hints | Moderate — well-defined contracts we understand deeply |
| **Approval/interrupt flows** | `requireApproval` in `before_tool_call` — pauses agent, shows UI card | High — requires channel-side UI coordination |
| **Session + context management** | Context window, compaction, token counting, history threading | High — subtle and error-prone |
| **CLI and gateway daemon** | `openclaw gateway start/stop`, ACP protocol, session management | High — 50k+ lines of Node infrastructure |
| **Agent-to-agent (ACP)** | Session spawn, `sessions_send`, subagent orchestration | Very high — protocol design + multi-agent coordination |
| **Web portal** | Cron management, plugin config UI, session inspector | Moderate — we could skip this |
| **Skill system** | SKILL.md conventions, skill routing, task delegation | Low — just a convention, we could replicate |
| **Heartbeat/cron system** | Scheduled tasks, cron management, TaskFlow | Moderate — we use this heavily |

### Things We Don't Use But Would Miss
- **Multi-channel routing** — run the same agent on Discord AND Telegram. We're Discord-only now but this would hurt.
- **Model switching** — `/model claude-opus` mid-session. Trivial from user POV, non-trivial to build.
- **Canvas/UI primitives** — buttons, polls, embeds, thread creation. We use these for guardrail prompts.

### Things OpenClaw Doesn't Give Us (Our IP)
- Thermodynamic memory decay (heat system)
- SIU pipeline (SIVU/SICU/SILU/SIRU) — trainable classification + adaptive recall
- Knowledge graph (Apache AGE) with entity relationship recall
- Session-scoped ephemeral memory
- Cross-agent memory sync + namespace isolation
- Conflict detection + diversity filtering
- SIRU recall logging + weight learning
- The guardrails layer (Tasks 53-55) — not implemented yet but entirely our design

---

## The Constraints That Hurt

From the audit (Task 51), these are the genuine pains:

### Hard Constraints (Can't Work Around)
1. **No prompt position control** — We can't guarantee Sulcus context appears before other plugin injections. If Mem0 is also loaded, we don't know who wins or where our block lands.
2. **No LLM parameter access** — Can't reduce temperature for memory-critical operations, can't choose a better model for SIVU analysis calls.
3. **Compaction is opaque** — We can capture *before* compaction but can't influence *what* gets kept.
4. **Plugin load order is undefined** — If two memory plugins register `registerMemoryRuntime`, last-writer-wins. We have no documented priority.

### Soft Constraints (Annoying but Workable)
5. **TOKEN_BUDGET hardcoded at 2000** — Trivially fixed: expose as config key `maxContextTokens`.
6. **No session concept parity** — Our `CURRENT_SESSION_ID` ≠ OpenClaw session. Acceptable with our current approach.
7. **`allowConversationAccess` flag required** — One manifest line. Dooley needs to know to enable it.
8. **Hook API is implicit** — We learned the return shapes by reading source and testing. Not formally documented.

### Things That Felt Like Constraints But Aren't
- The hook system itself is fine. We have everything we need for guardrails (Tasks 53-55) without any OpenClaw changes.
- The plugin API is stable enough — same contracts since v5+ (based on our plugin history).
- The channel layer is genuinely valuable. Discord alone would be months of direct API work.

---

## Scenario A: Stay on OpenClaw + Extend

**What we do:** Continue as a plugin. Implement Tasks 53-58 (guardrails, tool guard, validation tooling). Push for `allowConversationAccess`. Expose `TOKEN_BUDGET` as config. Live with prompt position ambiguity.

### Pros
- **We own the hard IP.** The SIU pipeline, heat decay, knowledge graph — all Sulcus server-side. OpenClaw is just the delivery vehicle.
- **Channel connectors for free.** Discord, Telegram, whatever comes next — we get them as they're added to OpenClaw without building them ourselves.
- **Multi-model routing for free.** Azure, Anthropic, OpenAI — already handled. Our cloud backend works with any LLM via the plugin.
- **Ecosystem leverage.** ClawHub distribution, community plugins, ACP ecosystem. Real distribution without our own app stores.
- **Speed to features.** We can ship guardrails (Tasks 53-55) THIS WEEK. A fork delays everything by months.
- **Low maintenance burden.** OpenClaw bugs are their problem. We maintain one plugin, one server.
- **The constraints we hit are mostly solved.** Prompt position matters less when we're the only memory plugin (our use case). LLM param access isn't needed for what we're building.

### Cons
- **Prompt position depends on being the only memory plugin.** Multi-plugin setups could conflict — but we control our install and Dooley runs one memory backend.
- **We're dependent on their release cadence.** If OpenClaw breaks an API, we fix it. That said: we've been on v5+ for months with no breaking changes.
- **`before_tool_call` approval UI is their UI.** We can't customize the card design. Acceptable tradeoff.
- **No way to observe other plugins.** We can't audit what else is injecting context. Accepted risk.

**Verdict:** Strong choice for current scale. The constraints are real but mostly theoretical at our use case (one human, controlled plugin set, Discord-primary).

---

## Scenario B: Fork OpenClaw

**What we do:** Clone the OpenClaw repo, maintain our own branch, patch what bothers us, ship a "Sulcus-native" agent runtime.

### What We'd Fix in a Fork
- Add prompt position control (enforce Sulcus injection priority)
- Expose LLM parameters to plugins
- Add memory-plugin priority resolution
- Make compaction strategy extensible
- Add a `before_llm_call` hook (not in upstream)
- Remove features we don't use (skill marketplace, multi-agent visual UI, etc.)

### The Real Costs of a Fork

**Maintenance overhead is asymmetric.** OpenClaw ships updates. Every update we need to merge into our fork, resolve conflicts, test. Based on the changelog cadence we've seen, this is weekly work for one developer. That's Dooley's time.

**We'd still be running their channel layer.** The Discord connector, Telegram connector, OAuth flows — we'd still depend on the code we forked. Any security fix upstream needs manual merge.

**Distribution breaks.** We'd lose ClawHub. Any user who installs from ClawHub gets upstream OpenClaw, not our fork. Our fork is a private branch or a competing product.

**It's not a fork, it's a product.** A fork we maintain seriously becomes a competing agent runtime product with branding, release management, docs, and community. That's a company product, not a Sulcus improvement.

**The bottleneck isn't OpenClaw.** Looking at what we've actually built in the last 30 days (Tasks 1-51): everything we've shipped has been either Sulcus server or the plugin itself. OpenClaw hasn't blocked us once. The constraints are real but we haven't actually hit them in a way that stopped work.

### Specific Cases Where a Fork Makes Sense
- We're selling a "complete agent experience" and the UX of the host runtime matters to buyers
- OpenClaw breaks a critical API and refuses to fix it (hasn't happened)
- We need to ship a feature that requires OpenClaw internals (e.g. custom approval card UI)
- We want to replace the LLM routing layer with our own (latency optimization, cost optimization)

**Verdict:** Not the right move now. Reopen this if we're selling a hosted agent product, or if OpenClaw breaks something critical. The maintenance cost isn't justified by the constraints we've actually hit.

---

## Scenario C: Build a Thin Agent Runtime Around Sulcus

**What we do:** Write a minimal agent loop — `[receive message] → [inject Sulcus context] → [call LLM] → [parse + handle tools] → [send response] → [capture memories]`. Sulcus owns the entire lifecycle. No OpenClaw dependency.

### What "Thin Runtime" Means in Practice

```
sulcus-agent/
  src/
    runtime.ts      # main loop
    channels/       # Discord, Telegram, etc.
    tools/          # tool registry + dispatch
    llm/            # provider routing
    hooks/          # our own hook lifecycle
    memory/         # deep Sulcus integration
  config/
    agent.json      # persona, model, tools
```

This is essentially building OpenClaw from scratch, minus the features we don't need.

### The Seductive Part

We'd get:
- Full control over context assembly (we own the prompt, every byte)
- Full LLM parameter access per turn
- Memory-first design — every feature designed around Sulcus, not retrofitted
- No plugin API versioning concerns
- Clean architecture that reflects how we actually use the system

### The Painful Part

**Building a Discord bot from scratch is weeks of work.** Rate limiting, gateway reconnection, thread management, reaction handling, voice, forum posts, attachments — all of it. We've been relying on OpenClaw's connector for all of this invisibly.

**Tool dispatch is non-trivial.** Streaming tool calls, parallel tool execution, retry on error, approval gates, sub-agent delegation — OpenClaw's tool system handles edge cases we've never thought about because they're invisible to us.

**LLM streaming is messy.** Streaming responses, partial JSON tool calls, multi-turn tool loops — getting this right for all providers (Azure, Anthropic, OpenAI) is real engineering work.

**We'd lose the cron/TaskFlow system.** The Sulcus improvement cycle you're reading from runs because of OpenClaw's scheduler. We'd need to replicate that.

**Maintenance is now ours entirely.** Discord API changes, Anthropic streaming protocol changes, Azure endpoint deprecations — all our problem, all the time.

### When This Makes Sense
- We're shipping Sulcus as a standalone product with our own UX
- We're targeting an environment OpenClaw doesn't support (embedded, WASM, mobile)
- We want to open-source the runtime as a distribution strategy for Sulcus

**Verdict:** Right vision, wrong timing. This is what Sulcus v2 might look like if we're selling a complete agent platform. Not now.

---

## The Honest Recommendation

**Stay on OpenClaw. Ship the guardrails layer (Tasks 53-55). Reassess in 90 days.**

Here's why:

1. **The constraints we've hit are not blocking.** Every task in the backlog (Tasks 52-59) is achievable within the current plugin system. We've never shipped "we can't do this because of OpenClaw."

2. **The real IP is Sulcus server-side.** The heat system, SIU pipeline, knowledge graph, namespace isolation, adaptive recall — none of that is in OpenClaw. OpenClaw is the delivery vehicle, not the competitive moat.

3. **Channel connectors are genuinely valuable.** We'd spend months building what OpenClaw gives us for free. That's months not spent on Sulcus.

4. **The fork/rewrite impulse often means "I'm frustrated."** The trigger was `message_sending` silently dropping messages instead of explaining. That's a 20-line fix (replace content instead of cancel). Let's fix the pain, not rebuild the house.

5. **The right future path is Option C (thin runtime), but it's a product decision, not a technical fix.** When we're ready to sell Sulcus as a standalone product with our own onboarding, UX, and distribution — then we build the runtime. Not before.

### What We Should Actually Do

- **Immediate:** Add `allowConversationAccess: true` to manifest, expose `TOKEN_BUDGET` as config. Two-line fixes.
- **This sprint:** Implement Tasks 53-55 (guardrails, tool guard, validation tooling). The missing layer.
- **60-day horizon:** Evaluate whether we want to publish `sulcus-agent` as a standalone package — a minimal OpenClaw-independent runtime for users who want Sulcus without the full OpenClaw stack.
- **90-day horizon:** Revisit this document. If OpenClaw has broken something, blocked a critical feature, or we're scaling to users who need a different delivery model — then fork or build.

---

## What Would Change the Recommendation

Reopen this analysis if:
- OpenClaw breaks `registerMemoryRuntime` or the hook API (critical regression)
- We want to sell a "Sulcus Agent" product distinct from OpenClaw (product decision)
- We need prompt position guarantees for multi-plugin enterprise environments
- We need custom approval UI that OpenClaw won't expose to plugins
- We're targeting a platform OpenClaw doesn't support (mobile, embedded, serverless)
- A well-maintained fork already exists that's better aligned (check ecosystem quarterly)

---

## Ecosystem Notes (from research)

**`@swarmclawai/swarmclaw`** (v1.7.1, April 2026) — A multi-agent framework built on top of OpenClaw with orchestration, delegation, scheduling. Adds stuff to OpenClaw rather than replacing it. Not a fork candidate — a parallel layer.

**`@clawdbot/lobster`** (v2026.4.6) — Typed workflow pipelines for OpenClaw. Deterministic pipelines with approval gates. OpenClaw-native. Not relevant to our fork question.

**`openclaw-agent-runtime-contracts`** (v1.3.13) — Shared runtime contracts for planner/todo/session across runtimes. Suggests OpenClaw runtime variety exists but from a Chinese dev house (Gitee), not an established fork.

No well-maintained OpenClaw fork exists in the npm ecosystem as of 2026-04-29. The ecosystem is building *on* OpenClaw, not replacing it.

---

*Generated by Sulcus Improvement Cycle — Task 52*  
*OpenClaw integration audit: `openclaw-integration-audit.md`*
