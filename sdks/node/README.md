# Sulcus Node SDK

**Autonomous Memory and Semantic VMMU for AI Agents.** Zero dependencies.

Sulcus delivers persistent institutional memory, proactive context injection, and System 1 VCR relevance ranking for autonomous agents.

## Installation

> **Note:** Sulcus SDKs and companion libraries are distributed directly via GitHub and consumed using Git URLs, or installed into your coding harnesses via `sulcus connect all`.

```bash
# Clone directly from GitHub and build locally
git clone https://github.com/digitalforgeca/sulcus.git
cd sulcus/sdks/node && npm run build
```

## Quick Start

```ts
import { Sulcus } from "sulcus";

const client = new Sulcus({ apiKey: "sk-..." });

// Remember something
await client.remember("User prefers dark mode", { memoryType: "preference" });
await client.remember("Meeting with design team at 3pm", { memoryType: "episodic" });
await client.remember("API rate limit is 1000 req/min", { memoryType: "semantic" });

// Search memories
const results = await client.search("dark mode");
for (const m of results) {
  console.log(`[${m.memory_type}] ${m.pointer_summary} (score: ${m.current_heat.toFixed(2)})`);
}

// List active memories
const memories = await client.list({ pageSize: 10 });

// Update a memory
await client.update(memories[0].id, { label: "Updated preference" });

// Pin important memories (prevents decay)
await client.pin(memories[0].id);

// Forget
await client.forget(memories[0].id);
```

## Local Or Cloud

```ts
// Connect to local Sulcus daemon (default port 4203)
const localClient = new Sulcus({
  baseUrl: "http://127.0.0.1:4203",
});

// Or connect to managed Sulcus Cloud API
const cloudClient = new Sulcus({
  apiKey: "sk-...",
  baseUrl: "https://api.sulcus.ca",
});
```

When wiring MCP clients to the local binary, always invoke `sulcus mcp-proxy` (`"args": ["mcp-proxy"]`) so concurrent editor sessions share the local daemon without embedded PostgreSQL lock contention.

## Lifecycle Control

```ts
// Store with full control over retention
await client.remember("Deploy procedure for production", {
  memoryType: "procedural",
  decayClass: "glacial",      // "fast" | "normal" | "slow" | "glacial"
  isPinned: true,             // Prevents decay below minHeat
  minHeat: 0.5,               // Floor — never decays below this
  keyPoints: ["npm run build", "run migrations", "verify healthcheck"],
});

// Bulk update multiple memories at once
await client.bulkUpdate(["mem-1", "mem-2", "mem-3"], {
  isPinned: true,
});
```

## Memory Types

| Type | Description | Default Decay |
|------|-------------|---------------|
| `episodic` | Events, conversations, experiences | Fast |
| `semantic` | Facts, knowledge, definitions | Slow |
| `preference` | User preferences, settings | Normal |
| `procedural` | How-to knowledge, workflows | Slow |
| `fact` | Stable knowledge, decisions | Glacial |

## API Reference

### Client Constructor

`new Sulcus({ apiKey?, baseUrl?, namespace?, timeoutMs?, securityGuard? })`

Create a client. `baseUrl` defaults to Sulcus Cloud (`https://api.sulcus.ca`), or pass `http://127.0.0.1:4203` for the local workstation daemon.

---

### Core Memory

#### remember

`client.remember(content, options?) -> Promise<Memory>`

Store a memory with full lifecycle control. Options: `memoryType`, `decayClass` (`fast`, `normal`, `slow`, `glacial`), `isPinned`, `minHeat`, `keyPoints`, `trainOnThis`.

#### search

`client.search(query, options?) -> Promise<Memory[]>`

Semantic and lexical search. Results sorted by heat and relevance.

#### list

`client.list(options?) -> Promise<Memory[]>`

List memories with optional filters (`page`, `pageSize`, `memoryType`, `namespace`, `pinned`, `search`, `sort`, `order`).

#### getMemory

`client.getMemory(id) -> Promise<Memory>`

Get a single memory by ID.

#### update

`client.update(id, options) -> Promise<Memory>`

Update fields on a memory (`label`, `memoryType`, `isPinned`, `namespace`, `heat`, `trainOnThis`).

#### forget

`client.forget(id, opts?) -> Promise<void>`

Permanently delete a memory. Pass `{ trainOnThis: true }` to record a System 1 VCR rejection signal.

#### pin And unpin

`client.pin(id) / client.unpin(id) -> Promise<Memory>`

Pin or unpin a memory. Pinned memories do not decay.

#### bulkUpdate

`client.bulkUpdate(ids, options) -> Promise<BulkUpdateResult>`

Apply the same update to multiple memories at once.

#### bulkDelete

`client.bulkDelete({ ids?, memoryType?, namespace? }) -> Promise<number>`

Delete memories by IDs, type, or namespace. Returns count deleted.

#### hotNodes

`client.hotNodes(limit?) -> Promise<Memory[]>`

Return the hottest memories by current heat (descending).

---

### Agent Sync

#### sync

`client.sync(payload) -> Promise<object>`

Agent CRDT sync: push a sync payload and receive merged state across instances.

---

### Storage Status

#### storageStatus

`client.storageStatus() -> Promise<StorageStatus>`

Get storage status (node count, size bytes, namespace count).

---

### Account Management

#### whoami

`client.whoami() -> Promise<OrgInfo>`

Get account and org info for the current API key.

#### updateOrg

`client.updateOrg(patch) -> Promise<object>`

Update org settings.

#### inviteMember

`client.inviteMember(email, role?) -> Promise<object>`

Invite a member to the org by email.

#### removeMember

`client.removeMember(userId) -> Promise<void>`

Remove a member from the org.

#### metrics

`client.metrics() -> Promise<Metrics>`

Get storage and health metrics.

#### dashboard

`client.dashboard() -> Promise<object>`

Get dashboard statistics (total nodes, heat distribution, namespace counts).

#### graph

`client.graph() -> Promise<object>`

Get the memory graph visualization data (nodes and edges).

---

### Admin Operations

#### createInvite

`client.createInvite(email, role?) -> Promise<object>`

Generate an invite token (admin only).

#### sendInvite

`client.sendInvite(inviteToken) -> Promise<object>`

Send an invite email for a previously created token (admin only).

#### platformInvite

`client.platformInvite(payload) -> Promise<object>`

Create a platform-level invite for multi-tenant deployments (admin only).

#### usage

`client.usage() -> Promise<object>`

Get usage statistics for the current billing period (admin only).

#### telemetryStats

`client.telemetryStats() -> Promise<object>`

Get telemetry statistics (admin only).

#### listWaitlist

`client.listWaitlist(limit?, cursor?) -> Promise<object>`

List registered users on the waitlist (admin only).

---

### Access Keys

#### listKeys

`client.listKeys() -> Promise<object[]>`

List all API keys for the current tenant.

#### createKey

`client.createKey(name?) -> Promise<object>`

Create a new API key. The secret is shown only once.

#### revokeKey

`client.revokeKey(keyId) -> Promise<void>`

Revoke an API key permanently.

---

### Namespace Settings

#### setDefaultNamespace

`client.setDefaultNamespace(namespace) -> Promise<object>`

Set the default namespace for the current tenant.

---

### Thermodynamic Engine

#### getThermoConfig

`client.getThermoConfig() -> Promise<object>`

Get the current memory decay and resonance engine configuration.

#### setThermoConfig

`client.setThermoConfig(config) -> Promise<object>`

Update the memory decay and resonance engine configuration.

---

### Browser Extensions

#### extensionSync

`client.extensionSync() -> Promise<object>`

Get extension sync state for the current agent or browser session.

---

### Recall Feedback

#### feedback

`client.feedback(memoryId, signal) -> Promise<object>`

Send recall quality feedback (`relevant`, `irrelevant`, or `outdated`). Adjusts heat and stability via spaced repetition.

#### recallAnalytics

`client.recallAnalytics() -> Promise<object>`

Get recall quality analytics with per-type stats and tuning suggestions.

---

### Gamification Profile

#### xpProfile

`client.xpProfile() -> Promise<XpProfile>`

Get the XP profile (level, badges, streaks).

#### profile

`client.profile() -> Promise<XpProfile>`

Legacy alias for `xpProfile()`.

---

### Activity Log

#### activity

`client.activity(limit?, cursor?) -> Promise<object>`

Get the activity log for your tenant (paginated).

#### recordActivity

`client.recordActivity(action, opts?) -> Promise<object>`

Record a custom activity event.

---

### Reactive Triggers

#### listTriggers

`client.listTriggers() -> Promise<object[]>`

List all active memory triggers.

#### createTrigger

`client.createTrigger(event, action, opts?) -> Promise<object>`

Create a reactive trigger. Events: `on_store`, `on_recall`, `on_decay`, `on_boost`, `on_relate`, `on_threshold`. Actions: `notify`, `boost`, `pin`, `tag`, `deprecate`, `webhook`.

#### updateTrigger

`client.updateTrigger(triggerId, patch) -> Promise<object>`

Update a trigger.

#### deleteTrigger

`client.deleteTrigger(triggerId) -> Promise<void>`

Delete a trigger and its history.

#### triggerHistory

`client.triggerHistory(limit?) -> Promise<object[]>`

Get trigger firing history.

#### triggerFeedback

`client.triggerFeedback(opts) -> Promise<TriggerFeedbackResult>`

Submit feedback on a trigger firing (`positive`, `negative`, `false_positive`, `false_negative`, or `correction`).

#### listTriggerFeedback

`client.listTriggerFeedback(limit?) -> Promise<object[]>`

List trigger feedback entries.

---

### VCR Classifier

**System 1 VCR** (Value, Classification, and Retrieval) evaluates memory candidates via `/api/v1/vcr/*`, pairing neural Value and Archetype Classification heads with a 7-signal Retrieval scorer. Backward-compatible `siu*` and `getSiluConfig` aliases remain supported.

#### vcrClassify

`client.vcrClassify(text, opts?) -> Promise<VcrClassifyResult>`

Classify text via `POST /api/v1/vcr/classify`. Returns `{ memory_type, confidence, should_store, reasoning, model }`. Set `opts.qualityOnly` to skip the store/discard gate.

#### vcrStatus

`client.vcrStatus() -> Promise<VcrStatusResult>`

Get System 1 VCR model status via `GET /api/v1/vcr/status` (version, training state, accuracy, sample count).

#### vcrRetrain

`client.vcrRetrain(model?) -> Promise<object>`

Trigger a System 1 VCR model retrain via `POST /api/v1/vcr/retrain`.

#### vcrSignal

`client.vcrSignal(opts) -> Promise<VcrSignalResult>`

Record a System 1 VCR training signal (`correction`, `confirmation`, or `rejection`) via `POST /api/v1/vcr/signal`.

#### vcrSignals

`client.vcrSignals(opts?) -> Promise<object[]>`

List System 1 VCR training signals with pagination (`limit`, `offset`) via `GET /api/v1/vcr/signals`.

#### getVcrConfig

`client.getVcrConfig(namespace?) -> Promise<VcrConfigResult>`

Fetch System 1 VCR configuration via `GET /api/v1/settings/vcr` (or `/api/v1/settings/vcr/:namespace`).

```ts
// Classify text before storing via System 1 VCR
const result = await client.vcrClassify("User prefers dark mode");
console.log(result.memory_type);  // "preference"
console.log(result.confidence);   // 0.92
console.log(result.should_store); // true

// Record a correction signal if a prediction was wrong
await client.vcrSignal({
  memoryId: "mem-uuid",
  signalType: "correction",
  predictedType: "episodic",
  correctedType: "preference",
  contentSnapshot: "User prefers dark mode",
});

// Check System 1 VCR status
const status = await client.vcrStatus();
console.log(`VCR ${status.model} — ${status.status} (accuracy: ${status.accuracy})`);

// Submit trigger feedback
await client.triggerFeedback({
  feedbackType: "false_positive",
  triggerId: "trigger-uuid",
  notes: "Trigger fired on irrelevant memory",
});
```

---

### Billing Endpoints

#### createCheckoutSession

`client.createCheckoutSession(priceId, successUrl, cancelUrl) -> Promise<{ url, session_id }>`

Create a Stripe checkout session.

#### createSubscription

`client.createSubscription(payload) -> Promise<object>`

Create a Stripe subscription directly (server-side billing flows).

#### createPortalSession

`client.createPortalSession(returnUrl) -> Promise<{ url }>`

Create a Stripe customer portal session.

#### getProducts

`client.getProducts() -> Promise<BillingProduct[]>`

Get available billing products and plans. No auth required.

---

### Public Endpoints

#### status

`client.status() -> Promise<{ status, version?, ... }>`

Get the public status of the Sulcus service. Suitable for health checks.

#### join

`client.join(payload) -> Promise<object>`

Register a new account.

#### joinWaitlist

`client.joinWaitlist(email, metadata?) -> Promise<object>`

Join the Sulcus waitlist.

#### ingestTelemetry

`client.ingestTelemetry(payload) -> Promise<void>`

Submit telemetry data.

---

## Lifecycle Training

Every memory lifecycle action can generate training data for **System 1 VCR**, creating a continuous feedback loop that improves value gating, archetype classification, and retrieval ranking over time.

### Signal Sources

| Action | Method | Signal | Notes |
|--------|--------|--------|-------|
| **Store** | `remember("...", { trainOnThis: true })` | VCR Value + Archetype `accept` | Explicit opt-in |
| **Delete** | `forget(id, { trainOnThis: true })` | VCR Value `reject` | Teaches System 1 VCR to reject similar content |
| **Reclassify** | `update(id, { memoryType: "procedural", trainOnThis: true })` | VCR Archetype `reclassify` | Corrects archetype classification |
| **Pin** | `pin(id)` | VCR Value `accept` (high confidence) | Automatic — no flag needed |
| **Boost** | `update(id, { heat: 0.95 })` | VCR Value `accept` (medium confidence) | Automatic — no flag needed |

### Training Examples

```typescript
// Delete noise and train System 1 VCR to reject similar content
await client.forget("abc-123", { trainOnThis: true });

// Reclassify and train — this was labeled 'episodic' but should be 'procedural'
await client.update("abc-123", {
  memoryType: "procedural",
  trainOnThis: true,
});

// Pin — automatically generates high-confidence 'store' signal
await client.pin("abc-123");

// Manual heat boost — automatically generates medium-confidence 'store' signal
await client.update("abc-123", { heat: 0.95 });
```

See [docs/memory-lifecycle-training.md](../../docs/memory-lifecycle-training.md) and [docs/vcr-api.md](../../docs/vcr-api.md) for full documentation.

---

## Security Guardrails

The Sulcus Node.js SDK includes built-in security guardrails to prevent accidental credential leakage, SSRF, and injection attacks:

### Secret Guardrails

Agents frequently process sensitive information (API keys, private keys, database connection strings). Sulcus scans memory payloads before transmission via `securityGuard`:
- **`warn` (default):** Logs a warning to `console.warn` when sensitive credentials (AWS keys, SSH/RSA private keys, GitHub tokens, OpenAI keys, JWTs, DB connection URIs) are detected.
- **`reject`:** Throws `SecurityValidationError` and blocks memory storage.
- **`off`:** Disables client-side inspection.

```typescript
// Block storing secrets into memory
const client = new Sulcus({
  apiKey: "sk-...",
  securityGuard: "reject",
});

await client.remember("Database url: postgres://admin:secret@db:5432/main");
// -> throws SecurityValidationError: Security Alert: Detected sensitive credential...

// Scan content manually
const findings = client.scanSensitiveData("Deploy key: " + "AKIA" + "1234567890ABCDEF");
console.log(findings); // [{ type: "aws_access_key", pattern: "AWS Access Key", snippet: "AKIA...CDEF" }]
```

### Credential Masking

Instances of `Sulcus` implement custom Node.js inspection hooks (`Symbol.for('nodejs.util.inspect.custom')`) and `toJSON()` methods that automatically mask the API key (e.g. `sk-...cdef`), guaranteeing secrets are never leaked into console logging, stringification, or telemetry aggregators.

### Validation Tests

```bash
# Run automated validation suite (uses Node.js native test runner, zero extra test dependencies)
npm test

# Or run unified validation runner across all SDKs
../../scripts/validate_sdks.sh
```

---

## Runtime Requirements

- Node.js 18+ (uses native `fetch`)
- No runtime dependencies

## License

MIT
