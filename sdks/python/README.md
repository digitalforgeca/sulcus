# Sulcus Python SDK

**Thermodynamic memory for AI agents.** Zero dependencies.

Sulcus is a memory system where physics decides what to forget. Memories have heat — hot memories are instantly accessible, cold ones fade naturally. CRDT sync keeps agents in lockstep.

## Install

```bash
pip install sulcus
```

For async support:

```bash
pip install sulcus[async]
```

## Quick Start

```python
from sulcus import Sulcus

client = Sulcus(api_key="sk-...")

# Remember something
client.remember("User prefers dark mode", memory_type="preference")
client.remember("Meeting with design team at 3pm", memory_type="episodic")
client.remember("API rate limit is 1000 req/min", memory_type="semantic")

# Search memories
results = client.search("dark mode")
for m in results:
    print(f"[{m.memory_type}] {m.pointer_summary} (heat: {m.current_heat:.2f})")

# List hot memories
memories = client.list(limit=10)

# Update a memory
client.update(memories[0].id, label="Updated preference")

# Pin important memories (prevents decay)
client.pin(memories[0].id)

# Forget
client.forget(memories[0].id)
```

## Async

```python
import asyncio
from sulcus import AsyncSulcus

async def main():
    async with AsyncSulcus(api_key="sk-...") as client:
        await client.remember("async memory", memory_type="semantic")
        results = await client.search("async")
        print(results)

asyncio.run(main())
```

## Self-Hosted

```python
client = Sulcus(
    api_key="your-key",
    base_url="http://localhost:4200",
)
```

## Memory Lifecycle Control

```python
# Store with full control over retention
client.remember(
    "Deploy procedure for production",
    memory_type="procedural",
    decay_class="glacial",     # fast | normal | slow | glacial
    is_pinned=True,            # Prevents decay below min_heat
    min_heat=0.5,              # Floor — never decays below this
    key_points=["API integration", "memory types", "decay configuration"],
)

# Bulk update multiple memories at once
client.bulk_update(
    ids=["mem-1", "mem-2", "mem-3"],
    is_pinned=True,
    decay_class="stable",
)
```

## Memory Types

| Type | Description | Default Decay |
|------|-------------|---------------|
| `episodic` | Events, conversations, experiences | Fast |
| `semantic` | Facts, knowledge, definitions | Slow |
| `preference` | User preferences, settings | Medium |
| `procedural` | How-to knowledge, workflows | Slow |
| `fact` | Stable knowledge, decisions | Near-permanent |
| `synthesis` | Cross-memory inferences, summaries | Slow |
| `moment` | Significant interactions | Slow (custom) |

## API

Both `Sulcus` (sync) and `AsyncSulcus` (async) expose the same methods. Async versions require `pip install sulcus[async]` (`httpx`).

### Constructor

#### `Sulcus(api_key, base_url?, namespace?, timeout?)`

Create a client. `base_url` defaults to Sulcus Cloud (`https://api.sulcus.ca`).

---

### Core Memory

#### `.remember(content, *, memory_type?, decay_class?, is_pinned?, min_heat?, key_points?, namespace?) -> Memory`

Store a memory with full lifecycle control. `decay_class` controls retention speed (`volatile`, `normal`, `stable`, `permanent`). `key_points` are indexed for better recall.

#### `.search(query, *, limit?, memory_type?, namespace?) -> list[Memory]`

Text search. Results sorted by heat (most active first).

#### `.list(*, page?, page_size?, memory_type?, namespace?, pinned?, search?, sort?, order?) -> list[Memory]`

List memories with optional filters.

#### `.get(memory_id) -> Memory`

Get a single memory by ID.

#### `.update(memory_id, *, label?, memory_type?, is_pinned?, namespace?, heat?) -> Memory`

Update fields on a memory.

#### `.forget(memory_id) -> bool`

Permanently delete a memory.

#### `.pin(memory_id) / .unpin(memory_id) -> Memory`

Pin/unpin a memory. Pinned memories don't decay.

#### `.bulk_update(ids, *, label?, memory_type?, is_pinned?, namespace?, heat?) -> dict`

Apply the same update to multiple memories at once. Returns `{ updated, errors }`.

#### `.bulk_delete(ids?, memory_type?, namespace?) -> int`

Delete memories by IDs, type, or namespace. Returns count deleted.

#### `.hot_nodes(limit?) -> list[Memory]`

Return the hottest memories by current heat (descending).

---

### Sync

#### `.sync(payload) -> dict`

Agent CRDT sync — push a sync payload and receive merged state. Used by agent runtimes to reconcile memory state across instances.

---

### Storage

#### `.storage_status() -> dict`

Get storage status (node count, size bytes, namespace count).

---

### Account & Org

#### `.whoami() -> dict`

Get tenant/org info for the current API key.

#### `.update_org(**kwargs) -> dict`

Update org settings (name, etc.).

#### `.invite_member(email, role?) -> dict`

Invite a member to the org by email.

#### `.remove_member(user_id) -> bool`

Remove a member from the org.

#### `.metrics() -> dict`

Get storage and health metrics.

#### `.dashboard() -> dict`

Get dashboard statistics (total nodes, heat distribution, etc.).

#### `.graph() -> dict`

Get the memory graph visualization data (nodes + edges).

---

### Admin

#### `.create_invite(email, role?) -> dict`

Generate an invite token (admin only).

#### `.send_invite(invite_token) -> dict`

Send an invite email for a previously created token (admin only).

#### `.platform_invite(payload) -> dict`

Create a platform-level invite for multi-tenant deployments (admin only).

#### `.usage() -> dict`

Get usage statistics for the current billing period (admin only).

#### `.telemetry_stats() -> dict`

Get telemetry statistics (admin only).

#### `.list_waitlist(limit?, cursor?) -> dict`

List registered users on the waitlist (admin only).

---

### API Keys

#### `.list_keys() -> list[dict]`

List all API keys for the current tenant.

#### `.create_key(name?) -> dict`

Create a new API key. The secret is shown only once.

#### `.revoke_key(key_id) -> bool`

Revoke an API key permanently.

---

### Namespace ACL

Control which agent IDs can access which namespaces.

#### `.list_acl() -> list[dict]`

List all ACL entries for the current tenant. Each entry has `id`, `agent_id`, `namespace`, `policy`.

#### `.upsert_acl(agent_id, namespace, policy) -> dict`

Create or update an ACL entry. `policy` is `'allow'`, `'deny'`, or `'default'`.

#### `.delete_acl(acl_id) -> bool`

Delete an ACL entry by ID.

#### `.set_default_namespace(namespace) -> dict`

Set the default namespace for the current tenant.

---

### Thermodynamic Engine

#### `.get_thermo_config() -> dict`

Get the current thermodynamic engine configuration (decay profiles, resonance, etc.).

#### `.set_thermo_config(config) -> dict`

Update the thermodynamic engine configuration.

---

### Encryption (Enterprise — CMK)

Customer-Managed Key encryption via Azure Key Vault. Enterprise plan required.

#### `.get_encryption_config() -> dict`

Get the current CMK encryption configuration.

#### `.configure_encryption(config) -> dict`

Configure customer-managed encryption (`key_vault_url`, `key_name`, `provider`).

#### `.revoke_encryption() -> bool`

Revoke CMK encryption. Reverts to platform-managed keys.

#### `.validate_encryption(config) -> dict`

Validate a CMK config without applying it. Returns `{ ok, errors? }`.

#### `.encryption_audit_log(limit?) -> list[dict]`

Get the encryption audit log (key rotation, config changes, access events).

---

### Extensions

#### `.extension_sync() -> dict`

Get extension sync state for the current agent/browser session.

---

### Feedback & Analytics

#### `.feedback(memory_id, signal) -> dict`

Send recall quality feedback. `signal` is `'relevant'`, `'irrelevant'`, or `'outdated'`. Adjusts heat and stability via spaced-repetition.

#### `.recall_analytics(period?) -> dict`

Get recall quality analytics with per-type stats and tuning suggestions.

---

### XP / Gamification

#### `.xp_profile() -> dict`

Get the XP profile (level, badges, streaks). Primary path.

#### `.profile() -> dict` *(deprecated)*

Legacy alias for `xp_profile()` via `/gamification/profile`. Use `xp_profile()` instead.

---

### Activity

#### `.activity(limit?, cursor?) -> dict`

Get the activity log for your tenant (paginated).

#### `.record_activity(action, *, target_id?, target_label?, metadata?) -> dict`

Record a custom activity event.

---

### Triggers

#### `.list_triggers() -> list[dict]`

List all active memory triggers.

#### `.create_trigger(event, action, *, name?, description?, action_config?, filter_memory_type?, filter_namespace?, filter_label_pattern?, filter_heat_below?, filter_heat_above?, max_fires?, cooldown_seconds?) -> dict`

Create a reactive trigger. Events: `on_store`, `on_recall`, `on_decay`, `on_boost`, `on_relate`, `on_threshold`. Actions: `notify`, `boost`, `pin`, `tag`, `deprecate`, `webhook`.

#### `.update_trigger(trigger_id, **kwargs) -> dict`

Update a trigger.

#### `.delete_trigger(trigger_id) -> bool`

Delete a trigger and its history.

#### `.trigger_history(limit?) -> list[dict]`

Get trigger firing history.

#### `.trigger_feedback(feedback_type, *, trigger_id?, trigger_log_id?, event_type?, memory_id?, expected_action?, notes?, source?) -> dict`

Submit feedback on a trigger firing for SITU training. `feedback_type` is `'positive'`, `'negative'`, `'false_positive'`, `'false_negative'`, or `'correction'`.

#### `.list_trigger_feedback(limit?) -> list[dict]`

List trigger feedback entries.

---

### SIU v2 — Intelligent Classification

The Sulcus Intelligence Unit (SIU) v2 provides server-side classification for memory content. It determines memory type, confidence, and whether text should be stored.

#### `.siu_label(text, *, quality_only?) -> dict`

Classify text. Returns `{ memory_type, confidence, should_store, reasoning, model }`. Set `quality_only=True` to skip the store/discard decision.

#### `.siu_status() -> dict`

Get SIU model status: version, training state, accuracy, sample count.

#### `.siu_retrain(model?) -> dict`

Trigger a model retrain. Optionally pass a model identifier.

#### `.siu_signal(memory_id, signal_type, *, predicted_type?, predicted_store?, predicted_conf?, corrected_type?, corrected_store?, content_snapshot?, source?, namespace?) -> dict`

Record a training signal (correction/confirmation/rejection). Used to improve the model via feedback loops.

#### `.siu_signals(limit?, offset?) -> list[dict]`

List training signals with pagination.

```python
# Classify text before storing
result = client.siu_label("User prefers dark mode")
print(result["memory_type"])   # "preference"
print(result["confidence"])    # 0.92
print(result["should_store"])  # True

# If the prediction was wrong, record a correction
client.siu_signal(
    memory_id="mem-uuid",
    signal_type="correction",
    predicted_type="episodic",
    corrected_type="preference",
    content_snapshot="User prefers dark mode",
)

# Check model status
status = client.siu_status()
print(f"SIU {status['model']} — {status['status']} (accuracy: {status['accuracy']})")

# Submit trigger feedback
client.trigger_feedback(
    "false_positive",
    trigger_id="trigger-uuid",
    notes="Trigger fired on irrelevant memory",
)
```

---

### Billing

#### `.create_checkout_session(price_id, success_url, cancel_url) -> dict`

Create a Stripe checkout session. Returns `{ url, session_id }`.

#### `.create_subscription(payload) -> dict`

Create a Stripe subscription directly (server-side billing flows).

#### `.create_portal_session(return_url) -> dict`

Create a Stripe customer portal session. Returns `{ url }`.

#### `.get_products() -> list[dict]`

Get available billing products/plans. No auth required.

---

### Public (No Auth Required)

#### `.status() -> dict`

Get the public status of the Sulcus service. Returns `{ status: 'ok'|'degraded'|'down', ... }`.

#### `.join(payload) -> dict`

Register a new account.

#### `.join_waitlist(email, metadata?) -> dict`

Join the Sulcus waitlist.

#### `.ingest_telemetry(payload) -> None`

Submit telemetry data (used by SDKs/extensions).

---

## Memory Lifecycle Training

Every memory lifecycle action can generate training data for Sulcus's SIU (Semantic Inference Unit), creating a continuous feedback loop that improves memory quality over time.

### Training Signal Sources

| Action | Method | Signal | Notes |
|--------|--------|--------|-------|
| **Store** | `remember("...", train_on_this=True)` | SIVU `accept` | Explicit opt-in |
| **Delete** | `forget(id, train_on_this=True)` | SIVU `reject` | Teaches SIU to reject similar content |
| **Reclassify** | `update(id, memory_type="procedural", train_on_this=True)` | SICU `reclassify` | Corrects type classification |
| **Pin** | `pin(id)` | SIVU `accept` (high confidence) | Automatic — no flag needed |
| **Boost** | `update(id, heat=0.95)` | SIVU `accept` (medium confidence) | Automatic — no flag needed |

### Examples

```python
# Delete junk and train SIU to reject similar content
client.forget("abc-123", train_on_this=True)

# Reclassify and train — was 'episodic' but should be 'procedural'
client.update("abc-123", memory_type="procedural", train_on_this=True)

# Pin — automatically generates high-confidence 'store' signal
client.pin("abc-123")

# Manual heat boost — automatically generates medium-confidence 'store' signal
client.update("abc-123", heat=0.95)

# Async variants work identically
await async_client.forget("abc-123", train_on_this=True)
await async_client.pin("abc-123")
```

See [Memory Lifecycle Training](https://sulcus.ca/docs/training) for full documentation.

---

## License

MIT
