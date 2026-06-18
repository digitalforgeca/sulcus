# Sulcus Node.js SDK

**Thermodynamic memory for AI agents.** Zero dependencies.

Sulcus is a memory system where physics decides what to forget. Memories have heat — hot memories are instantly accessible, cold ones fade naturally. CRDT sync keeps agents in lockstep.

## Install

```bash
npm install @digitalforgestudios/sulcus-sdk
```

## Quick Start

```ts
import { Sulcus } from "@digitalforgestudios/sulcus-sdk";

const client = new Sulcus({ apiKey: "sk-..." });

// Remember something
await client.remember("User prefers dark mode", { memoryType: "preference" });
await client.remember("Meeting with design team at 3pm", { memoryType: "episodic" });
await client.remember("API rate limit is 1000 req/min", { memoryType: "semantic" });

// Search memories
const results = await client.search("dark mode");
for (const m of results) {
  console.log(`[${m.memory_type}] ${m.pointer_summary} (heat: ${m.current_heat.toFixed(2)})`);
}

// List hot memories
const memories = await client.list({ limit: 10 });

// Update a memory
await client.update(memories[0].id, { label: "Updated preference" });

// Pin important memories (prevents decay)
await client.pin(memories[0].id);

// Forget
await client.forget(memories[0].id);
```

## Self-Hosted

```ts
const client = new Sulcus({
  apiKey: "your-key",
  baseUrl: "http://localhost:4200",
});
```

## Memory Lifecycle Control

```ts
// Store with full control over retention
await client.remember("Deploy procedure for production", {
  memoryType: "procedural",
  decayClass: "glacial",     // "fast" | "normal" | "slow" | "glacial"
  isPinned: true,            // Prevents decay below minHeat
  minHeat: 0.5,             // Floor — never decays below this
  keyPoints: ["build image", "run health check", "verify version"],
});

// Bulk update multiple memories at once
await client.bulkUpdate(["mem-1", "mem-2", "mem-3"], {
  isPinned: true,
  decayClass: "stable",
});
```

## Memory Types

| Type | Description | Default Decay |
|------|-------------|---------------|
| `episodic` | Events, conversations, experiences | Fast |
| `semantic` | Facts, knowledge, definitions | Slow |
| `preference` | User preferences, settings | Medium |
| `procedural` | How-to knowledge, workflows | Slow |
| `fact` | Stable knowledge, decisions | Near-permanent |
| `synthesis` | Synthesized conclusions, distilled insights | Slow |

## API

### Constructor

#### `new Sulcus({ apiKey, baseUrl?, namespace?, timeoutMs? })`

Create a client. `baseUrl` defaults to Sulcus Cloud (`https://api.sulcus.ca`).

---

### Core Memory

#### `.remember(content, options?) → Promise<Memory>`

Store a memory with full lifecycle control. Options: `memoryType`, `decayClass` (`fast`/`normal`/`slow`/`glacial`), `isPinned`, `minHeat`, `keyPoints`.

#### `.search(query, options?) → Promise<Memory[]>`

Text search. Results sorted by heat (most active first).

#### `.list(options?) → Promise<Memory[]>`

List memories with optional filters (`page`, `pageSize`, `memoryType`, `namespace`, `pinned`, `search`, `sort`, `order`).

#### `.getMemory(id) → Promise<Memory>`

Get a single memory by ID.

#### `.update(id, options) → Promise<Memory>`

Update fields on a memory (`label`, `memoryType`, `isPinned`, `namespace`, `heat`).

#### `.forget(id) → Promise<void>`

Permanently delete a memory.

#### `.pin(id) / .unpin(id) → Promise<Memory>`

Pin/unpin a memory. Pinned memories don't decay.

#### `.bulkUpdate(ids, options) → Promise<BulkUpdateResult>`

Apply the same update to multiple memories at once.

#### `.bulkDelete({ ids?, memoryType?, namespace? }) → Promise<number>`

Delete memories by IDs, type, or namespace. Returns count deleted.

#### `.hotNodes(limit?) → Promise<Memory[]>`

Return the hottest memories by current heat (descending).

---

### Sync

#### `.sync(payload) → Promise<object>`

Agent CRDT sync — push a sync payload and receive merged state. Used by agent runtimes to reconcile memory state across instances.

---

### Storage

#### `.storageStatus() → Promise<StorageStatus>`

Get storage status (node count, size bytes, namespace count).

---

### Account & Org

#### `.whoami() → Promise<OrgInfo>`

Get account/org info for the current API key.

#### `.updateOrg(patch) → Promise<object>`

Update org settings (name, etc.).

#### `.inviteMember(email, role?) → Promise<object>`

Invite a member to the org by email.

#### `.removeMember(userId) → Promise<void>`

Remove a member from the org.

#### `.metrics() → Promise<Metrics>`

Get storage and health metrics.

#### `.dashboard() → Promise<object>`

Get dashboard statistics (total nodes, heat distribution, etc.).

#### `.graph() → Promise<object>`

Get the memory graph visualization data (nodes + edges).

---

### Admin

#### `.createInvite(email, role?) → Promise<object>`

Generate an invite token (admin only).

#### `.sendInvite(inviteToken) → Promise<object>`

Send an invite email for a previously created token (admin only).

#### `.platformInvite(payload) → Promise<object>`

Create a platform-level invite for multi-tenant deployments (admin only).

#### `.usage() → Promise<object>`

Get usage statistics for the current billing period (admin only).

#### `.telemetryStats() → Promise<object>`

Get telemetry statistics (admin only).

#### `.listWaitlist(limit?, cursor?) → Promise<object>`

List registered users on the waitlist (admin only).

---

### API Keys

#### `.listKeys() → Promise<object[]>`

List all API keys for the current tenant.

#### `.createKey(name?) → Promise<object>`

Create a new API key. The secret is shown only once.

#### `.revokeKey(keyId) → Promise<void>`

Revoke an API key permanently.

---

### Namespace ACL

Control which agent IDs can access which namespaces.

#### `.listAcl() → Promise<AclEntry[]>`

List all ACL entries for the current tenant.

#### `.upsertAcl(agentId, namespace, policy) → Promise<AclEntry>`

Create or update an ACL entry. `policy` is `'allow'`, `'deny'`, or `'default'`.

#### `.deleteAcl(aclId) → Promise<void>`

Delete an ACL entry by ID.

#### `.setDefaultNamespace(namespace) → Promise<object>`

Set the default namespace for the current tenant.

---

### Thermodynamic Engine

#### `.getThermoConfig() → Promise<object>`

Get the current thermodynamic engine configuration (decay profiles, resonance, etc.).

#### `.setThermoConfig(config) → Promise<object>`

Update the thermodynamic engine configuration.

---

### Encryption (Enterprise — CMK)

Customer-Managed Key encryption via Azure Key Vault. Enterprise plan required.

#### `.getEncryptionConfig() → Promise<EncryptionConfig>`

Get the current CMK encryption configuration.

#### `.configureEncryption(config) → Promise<EncryptionConfig>`

Configure customer-managed encryption (`key_vault_url`, `key_name`, `provider`).

#### `.revokeEncryption() → Promise<void>`

Revoke CMK encryption. Reverts to platform-managed keys.

#### `.validateEncryption(config) → Promise<{ ok, errors? }>`

Validate a CMK config without applying it.

#### `.encryptionAuditLog(limit?) → Promise<EncryptionAuditEntry[]>`

Get the encryption audit log (key rotation, config changes, access events).

---

### Extensions

#### `.extensionSync() → Promise<object>`

Get extension sync state for the current agent/browser session.

---

### Feedback & Analytics

#### `.feedback(memoryId, signal) → Promise<object>`

Send recall quality feedback. `signal` is `'relevant'`, `'irrelevant'`, or `'outdated'`. Adjusts heat and stability via spaced-repetition.

#### `.recallAnalytics() → Promise<object>`

Get recall quality analytics with per-type stats and tuning suggestions.

---

### XP / Gamification

#### `.xpProfile() → Promise<XpProfile>`

Get the XP profile (level, badges, streaks). Primary path.

#### `.profile() → Promise<XpProfile>` *(deprecated)*

Legacy alias for `xpProfile()` via `/gamification/profile`. Use `xpProfile()` instead.

---

### Activity

#### `.activity(limit?, cursor?) → Promise<object>`

Get the activity log for your tenant (paginated).

#### `.recordActivity(action, opts?) → Promise<object>`

Record a custom activity event.

---

### Triggers

#### `.listTriggers() → Promise<object[]>`

List all active memory triggers.

#### `.createTrigger(event, action, opts?) → Promise<object>`

Create a reactive trigger. Events: `on_store`, `on_recall`, `on_decay`, `on_boost`, `on_relate`, `on_threshold`. Actions: `notify`, `boost`, `pin`, `tag`, `deprecate`, `webhook`.

#### `.updateTrigger(triggerId, patch) → Promise<object>`

Update a trigger.

#### `.deleteTrigger(triggerId) → Promise<void>`

Delete a trigger and its history.

#### `.triggerHistory(limit?) → Promise<object[]>`

Get trigger firing history.

#### `.triggerFeedback(opts) → Promise<TriggerFeedbackResult>`

Submit feedback on a trigger firing for SITU training. `opts.feedbackType` is `'positive'`, `'negative'`, `'false_positive'`, `'false_negative'`, or `'correction'`. Optional: `triggerId`, `triggerLogId`, `eventType`, `memoryId`, `expectedAction`, `notes`, `source`.

#### `.listTriggerFeedback(limit?) → Promise<object[]>`

List trigger feedback entries.

---

### SIU v2 — Intelligent Classification

The Sulcus Intelligence Unit (SIU) v2 provides server-side classification for memory content. It determines memory type, confidence, and whether text should be stored.

#### `.siuLabel(text, opts?) → Promise<SiuLabelResult>`

Classify text. Returns `{ memory_type, confidence, should_store, reasoning, model }`. Set `opts.qualityOnly` to skip the store/discard decision.

#### `.siuStatus() → Promise<SiuStatusResult>`

Get SIU model status: version, training state, accuracy, sample count.

#### `.siuRetrain(model?) → Promise<object>`

Trigger a model retrain. Optionally pass a model identifier.

#### `.siuSignal(opts) → Promise<SiuSignalResult>`

Record a training signal (correction/confirmation/rejection). Used to improve the model via feedback loops.

#### `.siuSignals(opts?) → Promise<object[]>`

List training signals with pagination (`limit`, `offset`).

```ts
// Classify text before storing
const result = await client.siuLabel("User prefers dark mode");
console.log(result.memory_type);  // "preference"
console.log(result.confidence);   // 0.92
console.log(result.should_store); // true

// If the prediction was wrong, record a correction
await client.siuSignal({
  memoryId: "mem-uuid",
  signalType: "correction",
  predictedType: "episodic",
  correctedType: "preference",
  contentSnapshot: "User prefers dark mode",
});

// Check model status
const status = await client.siuStatus();
console.log(`SIU ${status.model} — ${status.status} (accuracy: ${status.accuracy})`);

// Submit trigger feedback
await client.triggerFeedback({
  feedbackType: "false_positive",
  triggerId: "trigger-uuid",
  notes: "Trigger fired on irrelevant memory",
});
```

---

### Billing

#### `.createCheckoutSession(priceId, successUrl, cancelUrl) → Promise<{ url, session_id }>`

Create a Stripe checkout session.

#### `.createSubscription(payload) → Promise<object>`

Create a Stripe subscription directly (server-side billing flows).

#### `.createPortalSession(returnUrl) → Promise<{ url }>`

Create a Stripe customer portal session (manage subscription/invoices).

#### `.getProducts() → Promise<BillingProduct[]>`

Get available billing products/plans. No auth required.

---

### Public (No Auth Required)

#### `.status() → Promise<{ status, version?, ... }>`

Get the public status of the Sulcus service. Suitable for health checks.

#### `.join(payload) → Promise<object>`

Register a new account.

#### `.joinWaitlist(email, metadata?) → Promise<object>`

Join the Sulcus waitlist.

#### `.ingestTelemetry(payload) → Promise<void>`

Submit telemetry data (used by SDKs/extensions).

---

## Memory Lifecycle Training

Every memory lifecycle action can generate training data for Sulcus's SIU (Semantic Inference Unit), creating a continuous feedback loop that improves memory quality over time.

### Training Signal Sources

| Action | Method | Signal | Notes |
|--------|--------|--------|-------|
| **Store** | `remember("...", { trainOnThis: true })` | SIVU `accept` | Explicit opt-in |
| **Delete** | `forget(id, { trainOnThis: true })` | SIVU `reject` | Teaches SIU to reject similar content |
| **Reclassify** | `update(id, { memoryType: "procedural", trainOnThis: true })` | SICU `reclassify` | Corrects type classification |
| **Pin** | `pin(id)` | SIVU `accept` (high confidence) | Automatic — no flag needed |
| **Boost** | `update(id, { heat: 0.95 })` | SIVU `accept` (medium confidence) | Automatic — no flag needed |

### Examples

```typescript
// Delete junk and train SIU to reject similar content
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

See [Memory Lifecycle Training](https://sulcus.ca/docs/training) for full documentation.

---

## Requirements

- Node.js 18+ (uses native `fetch`)
- No runtime dependencies

## License

MIT
