# SULCUS Ecosystem & Product Roadmap

## The Funnel: From Zero to Enterprise

The SULCUS product suite is designed as a frictionless acquisition funnel. Users enter through free, zero-install tools and are organically up-sold into enterprise coordination layers as their agentic needs scale.

---

## 1. Product: "The Acquisition Layer" (Sulcus Web & Extension)
**Artifacts:** `packages/sulcus-web`, `packages/sulcus-extension`
**Persona:** The Curious Developer / Power User
**Pricing:** Free

**Purpose:** To eliminate the barrier to entry. Users install the browser extension to give "memory" to Claude.ai or ChatGPT. It uses WASM and IndexedDB entirely locally.
**The Hook:** It works perfectly until the user accumulates 10GB of memory or wants to share their agent's context with a second device (laptop to desktop).
**Plan of Action:** 
- Launch the Next.js marketing site (`sulcus.io`).
- Publish the extension to the Chrome Web Store.
- **Conversion Trigger:** When local storage fills, pop a UI modal: *"You've reached your local context limit. Upgrade to Sulcus Team to sync to the Cloud."*

---

## 2. Product: "The Builder Layer" (Sulcus Core & Local)
**Artifacts:** `crates/sulcus-core`, `crates/sulcus-local`, `packages/openclaw-sulcus`, `crates/sulcus-wasm`
**Persona:** AI Application Developers (Building with OpenClaw/LangChain)
**Pricing:** Proprietary (Free tier available via hosted service)

**Purpose:** The "Trojan Horse" for developer adoption. Developers embed `sulcus-local` (via MCP or OpenClaw plugin) into their custom apps. It runs an embedded PGlite instance and provides the raw thermodynamic graph algorithms.
**The Hook:** A solo developer builds a great agent. Then they deploy it to production and realize they need a central "Golden Index" to sync memory between their 50 parallel worker nodes.
**Plan of Action:**
- Publish `@sulcus/mem` and `openclaw-sulcus` to NPM.
- Write a "How to add memory to your OpenClaw agent in 5 minutes" tutorial.
- **Conversion Trigger:** Developer realizes `sync_now` requires a `server_url`. They land on our SaaS portal.

---

## 3. Product: "The Revenue Engine" (Sulcus Server)
**Artifacts:** `crates/sulcus-server`
**Persona:** Enterprise CTOs, Multi-Agent Fleet Operators
**Pricing:** TEAM ($299/mo) / ENTERPRISE (Custom)

**Purpose:** This is the SaaS Hub. It provides cryptographic tenant isolation, remote SSE MCP connections, OIDC/SSO, and usage telemetry. It solves the "Collective Brain" problem for teams of agents.
**The Hook:** The cost of tokens. SULCUS reduces context window token burn by 90% by intelligently paging memories. The $299/mo fee easily pays for itself in OpenAI API savings.
**Plan of Action:**
- Maintain the Azure-deployed server.
- Finalize Stripe Webhook billing enforcement (so the `openclaw sulcus join <token>` command only works for paying tenants).
- Launch the "ROI of the Collective Brain" whitepaper on LinkedIn and HackerNews.

---

## The Product Mesh (How they interact)
1. User installs **Extension** (Product 1).
2. Extension uses **WASM Core** (Product 2) in the browser.
3. User hits storage limit, clicks "Sync".
4. Extension negotiates an API Key with **Server** (Product 3) via Stripe Checkout.
5. User's local memories push to the **Global Golden Index**.
