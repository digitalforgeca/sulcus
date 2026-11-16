# Python SDK

**Persistent Memory and System 1 VCR for AI Agents.** Zero required dependencies beyond the Python standard library (`httpx` optional for async).

Sulcus delivers persistent institutional memory, proactive context injection, reactive graph triggers, and System 1 VCR value gating and retrieval scoring for autonomous agents.

## Installation

> **Note:** Sulcus SDKs are distributed directly via GitHub and installed via Git URLs.

```bash
# Install directly from GitHub
pip install "git+https://github.com/digitalforgeca/sulcus.git#subdirectory=sdks/python"

# With async support (httpx)
pip install "sulcus[async] @ git+https://github.com/digitalforgeca/sulcus.git#subdirectory=sdks/python"
```

## Quick Start

```python
from sulcus import Sulcus

client = Sulcus(api_key="sk-...")

# Store memories
client.remember("User prefers dark mode", memory_type="preference")
client.remember("Sprint planning every Monday at 10am", memory_type="episodic")
client.remember("API rate limit is 1000 req/min", memory_type="semantic")

# Search memories
results = client.search("dark mode")
for m in results:
    print(f"[{m.memory_type}] {m.pointer_summary} (heat: {m.current_heat:.2f})")

# List active memories
memories = client.list(page_size=10)

# Update a memory
client.update(memories[0].id, label="Updated preference")

# Pin important memories (prevents decay)
client.pin(memories[0].id)

# Forget a memory
client.forget(memories[0].id)
```

## Async Client

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

## Local Engine

For local workstation setups, run the local Sulcus daemon (`http://127.0.0.1:4203`). IDE and MCP agent clients connect concurrently without database lock contention via `sulcus mcp-proxy`.

```python
# Connect to local Sulcus engine (default port 4203, no API key required)
client = Sulcus(base_url="http://127.0.0.1:4203")

# Or connect to Sulcus Cloud
client = Sulcus(
    api_key="sk-...",
    base_url="https://api.sulcus.ca",
)
```

## Lifecycle Control

```python
# Store with full control over retention
client.remember(
    "Deploy procedure for production",
    memory_type="procedural",
    decay_class="glacial",     # fast | normal | slow | glacial
    is_pinned=True,            # Prevents decay below min_heat
    min_heat=0.5,              # Floor — never decays below this
    key_points=["pytest", "run migrations", "verify healthcheck"],
)

# Bulk update multiple memories at once
client.bulk_update(
    ids=["mem-1", "mem-2", "mem-3"],
    is_pinned=True,
)
```

## Memory Types

| Type | Description | Default Decay |
|------|-------------|---------------|
| `episodic` | Events, conversations, experiences | Fast |
| `semantic` | Facts, knowledge, definitions | Slow |
| `preference` | User preferences, settings | Medium |
| `procedural` | Workflows, runbooks, instructions | Slow |
| `fact` | Durable decisions and ground truth | Glacial |

## API Reference

Both `Sulcus` (sync) and `AsyncSulcus` (async) expose the same methods.

### Client Setup

- **`Sulcus(api_key=None, base_url="https://api.sulcus.ca", namespace="default", timeout=15.0, security_guard="warn")`** — Create a synchronous client (or `AsyncSulcus(...)` for async). `api_key` is optional for localhost endpoints (`http://127.0.0.1:4203`).

### Core Memory

- **`.remember(content, *, memory_type="episodic", heat=0.8, namespace=None, is_pinned=False, modality="text", decay_class=None, min_heat=None, key_points=None, train_on_this=False) -> Memory`** — Store a memory with full lifecycle control.
- **`.search(query, *, limit=10, memory_type=None, namespace=None, min_heat=None) -> list[Memory]`** — Hybrid semantic and System 1 VCR retrieval search.
- **`.list(*, page=1, page_size=25, memory_type=None, namespace=None, pinned=None, modality=None, sort=None, order=None, search=None) -> list[Memory]`** — List memories with pagination and filters.
- **`.get(memory_id) -> Memory`** — Fetch a single memory node by ID.
- **`.update(memory_id, *, label=None, memory_type=None, is_pinned=None, namespace=None, heat=None, train_on_this=False) -> Memory`** — Update fields on an existing memory.
- **`.forget(memory_id, *, train_on_this=False) -> bool`** — Permanently delete a memory.
- **`.pin(memory_id) -> Memory`** / **`.unpin(memory_id) -> Memory`** — Pin or unpin a memory.
- **`.bulk_update(ids, *, label=None, memory_type=None, is_pinned=None, namespace=None, heat=None) -> dict`** — Apply updates across multiple memory IDs.
- **`.bulk_delete(*, ids=None, memory_type=None, namespace=None) -> int`** — Bulk delete memories by ID list, type, or namespace.
- **`.hot_nodes(limit=20) -> list[Memory]`** — Return the hottest active memories.
- **`.build_context(query="", *, token_budget=2000, namespace=None, min_heat=None, format="xml") -> str`** — Assemble a token-budgeted context envelope combining hot memories, query results, active triggers, and notifications.

### Memory Sync

- **`.sync(payload) -> dict`** — Push a CRDT sync payload and receive merged state.

### Storage Status

- **`.storage_status() -> dict`** — Inspect node count, storage bytes, and namespace totals.

### Account Management

- **`.whoami() -> dict`** — Get tenant and organization details for the current API key.
- **`.update_org(**kwargs) -> dict`** — Update organization settings.
- **`.invite_member(email, role="member") -> dict`** — Invite a team member by email.
- **`.remove_member(user_id) -> bool`** — Remove a member from the organization.
- **`.metrics() -> dict`** — Fetch storage and health metrics.
- **`.dashboard() -> dict`** — Fetch dashboard summary statistics.
- **`.graph() -> dict`** — Fetch memory graph nodes and edges.

### Admin Tools

- **`.create_invite(email, role="member") -> dict`** — Generate an invite token.
- **`.send_invite(invite_token) -> dict`** — Dispatch an invite email.
- **`.platform_invite(payload) -> dict`** — Create a platform-level invite.
- **`.usage() -> dict`** — Inspect current billing period usage.
- **`.telemetry_stats() -> dict`** — Retrieve telemetry statistics.
- **`.list_waitlist(limit=50, cursor=None) -> dict`** — List waitlist entries.

### API Keys

- **`.list_keys() -> list[dict]`** — List API keys for the current tenant.
- **`.create_key(name=None) -> dict`** — Create a new API key.
- **`.revoke_key(key_id) -> bool`** — Permanently revoke an API key.

### Namespace Settings

- **`.set_default_namespace(namespace) -> dict`** — Set the default namespace for the current tenant.

### Decay Engine

- **`.get_thermo_config() -> dict`** — Inspect memory decay profiles and resonance weights.
- **`.set_thermo_config(config) -> dict`** — Update memory decay and resonance configuration.

### Browser Extensions

- **`.extension_sync() -> dict`** — Fetch extension sync state for the active session.

### Recall Feedback

- **`.feedback(memory_id, signal) -> dict`** — Send recall quality feedback (`'relevant'`, `'irrelevant'`, or `'outdated'`).
- **`.recall_analytics(period=None) -> dict`** — Inspect recall quality analytics and tuning recommendations.

### Experience Profile

- **`.xp_profile() -> dict`** — Fetch the XP profile (level, badges, streaks).

### Activity Ledger

- **`.activity(limit=50, cursor=None) -> dict`** — Fetch the paginated activity ledger.
- **`.record_activity(action, *, target_id=None, target_label=None, metadata=None) -> dict`** — Record a custom activity event.

### Reactive Triggers

- **`.list_triggers() -> list[dict]`** — List active reactive triggers.
- **`.create_trigger(event, action, *, train_on_this=False, **kwargs) -> dict`** — Create a reactive trigger (`on_store`, `on_recall`, `on_decay`, `on_boost`, `on_relate`, `on_threshold` -> `notify`, `boost`, `pin`, `tag`, `deprecate`, `webhook`).
- **`.update_trigger(trigger_id, **kwargs) -> dict`** — Update an existing trigger.
- **`.delete_trigger(trigger_id) -> bool`** — Delete a trigger and its history.
- **`.trigger_history(limit=50) -> list[dict]`** — Inspect trigger firing history.
- **`.trigger_feedback(feedback_type, *, trigger_id=None, trigger_log_id=None, event_type=None, memory_id=None, expected_action=None, notes=None, source="sdk") -> dict`** — Submit feedback (`'positive'`, `'negative'`, `'false_positive'`, `'false_negative'`, `'correction'`) for reactive trigger tuning.
- **`.list_trigger_feedback(limit=50) -> list[dict]`** — List recorded trigger feedback entries.

### VCR Classifier

System 1 VCR provides sub-millisecond value gating (`should_store`), memory archetype classification (`episodic`, `semantic`, `preference`, `procedural`, `fact`), and 7-signal retrieval scoring via `/api/v1/vcr/*` and `/api/v1/settings/vcr*`.

- **`.vcr_classify(text, *, quality_only=False) -> dict`** — Classify text via `POST /api/v1/vcr/classify`. Returns `{ memory_type, confidence, should_store, reasoning, model }`. Set `quality_only=True` to skip the store/discard gate. (`.vcr_label(...)` and legacy `.siu_label(...)` are supported aliases.)
- **`.vcr_status() -> dict`** — Fetch System 1 VCR model status, version, training sample counts, and accuracy via `GET /api/v1/vcr/status`. (Legacy `.siu_status()` alias supported.)
- **`.vcr_retrain(model=None) -> dict`** — Trigger a System 1 VCR model retrain via `POST /api/v1/vcr/retrain`. (Legacy `.siu_retrain()` alias supported.)
- **`.vcr_signal(memory_id, signal_type, *, predicted_type=None, predicted_store=None, predicted_conf=None, corrected_type=None, corrected_store=None, content_snapshot=None, source="sdk", namespace=None) -> dict`** — Record a System 1 VCR training signal (`'correction'`, `'confirmation'`, or `'rejection'`) via `POST /api/v1/vcr/signal`. (Legacy `.siu_signal(...)` alias supported.)
- **`.vcr_signals(limit=50, offset=0) -> list[dict]`** — List recorded training signals via `GET /api/v1/vcr/signals`. (Legacy `.siu_signals(...)` alias supported.)
- **`.vcr_models() -> dict`** — Fetch System 1 VCR model metadata and weights via `GET /api/v1/vcr/models`.
- **`.get_vcr_config(namespace=None) -> dict`** — Inspect global or per-namespace System 1 VCR settings via `GET /api/v1/settings/vcr`. (Legacy `.get_silu_config(...)` alias supported.)
- **`.update_vcr_config(namespace, **config) -> dict`** — Update per-namespace System 1 VCR settings via `PATCH /api/v1/settings/vcr/{namespace}`. (Legacy `.update_silu_config(...)` alias supported.)
- **`.reset_vcr_config(namespace) -> dict`** — Reset namespace System 1 VCR settings to global defaults via `DELETE /api/v1/settings/vcr/{namespace}`. (Legacy `.reset_silu_config(...)` alias supported.)

```python
# Classify text before storing
result = client.vcr_classify("User prefers dark mode")
print(result["memory_type"])   # "preference"
print(result["confidence"])    # 0.92
print(result["should_store"])  # True

# Record a correction signal if prediction differed
client.vcr_signal(
    memory_id="mem-uuid",
    signal_type="correction",
    predicted_type="episodic",
    corrected_type="preference",
    content_snapshot="User prefers dark mode",
)

# Check System 1 VCR status
status = client.vcr_status()
print(status)
```

### Billing Portal

- **`.create_checkout_session(price_id, success_url, cancel_url) -> dict`** — Create a Stripe checkout session.
- **`.create_subscription(payload) -> dict`** — Create a Stripe subscription directly.
- **`.create_portal_session(return_url) -> dict`** — Create a Stripe customer portal session.
- **`.get_products() -> list[dict]`** — List available subscription plans.

### Public Endpoints

- **`.status() -> dict`** — Public service health check (`ok`, `degraded`, `down`).
- **`.verify() -> dict`** — Validate the active API key and inspect tier limits.
- **`.join(payload) -> dict`** — Register a new account.
- **`.join_waitlist(email, metadata=None) -> dict`** — Join the waitlist.
- **`.ingest_telemetry(payload) -> None`** — Submit SDK telemetry events.

## Lifecycle Training

Every memory lifecycle action can emit training signals for System 1 VCR, creating a continuous feedback loop that sharpens value gating and archetype classification over time.

### Training Signals

| Action | Method | VCR Signal | Notes |
|--------|--------|------------|-------|
| **Store** | `remember("...", train_on_this=True)` | Value `accept` | Explicit opt-in |
| **Delete** | `forget(id, train_on_this=True)` | Value `reject` | Teaches VCR to reject similar noise |
| **Reclassify** | `update(id, memory_type="procedural", train_on_this=True)` | Archetype `reclassify` | Corrects archetype prediction |
| **Pin** | `pin(id)` | Value `accept` (high confidence) | Automatic |
| **Boost** | `update(id, heat=0.95)` | Value `accept` (medium confidence) | Automatic |

### Training Examples

```python
# Delete noise and train System 1 VCR to reject similar content
client.forget("abc-123", train_on_this=True)

# Reclassify a memory and emit an archetype training signal
client.update("abc-123", memory_type="procedural", train_on_this=True)

# Pinning automatically emits a high-confidence accept signal
client.pin("abc-123")

# Async variants work identically
await async_client.forget("abc-123", train_on_this=True)
await async_client.pin("abc-123")
```

See [System 1 VCR API Reference](../../docs/vcr-api.md) and [Memory Lifecycle Training](../../docs/memory-lifecycle-training.md) for full details.

## Security Guardrails

The Sulcus Python SDK includes client-side security guardrails to prevent accidental credential leakage, SSRF, and header injection.

### Secret Scanning

Sulcus scans memory payloads before transmission according to `security_guard`:
- **`warn` (default):** Emits `SensitiveDataWarning` when AWS keys, private keys, GitHub tokens, OpenAI keys, JWTs, or database URIs are detected.
- **`reject`:** Raises `SecurityValidationError` and blocks storage.
- **`off`:** Disables client-side scanning.

```python
client = Sulcus(api_key="sk-...", security_guard="reject")
client.remember("Database url: postgres://admin:secret@db:5432/main")
# -> raises SecurityValidationError

findings = client.scan_sensitive_data("Deploy key: " + "AKIA" + "1234567890ABCDEF")
print(findings)
```

### Credential Masking

Instances of `Sulcus` and `AsyncSulcus` mask API keys in `__repr__` and `__str__` (for example `sk-...cdef`) so credentials never leak into logs or tracebacks.

### Validation Tests

```bash
PYTHONPATH=sdks/python pytest sdks/python/tests -v
```

## License

MIT
