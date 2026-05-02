# sulcus-cli

Terminal CLI for [Sulcus](https://sulcus.ca) — Thermodynamic Memory for AI Agents.

Zero runtime dependencies beyond the `sulcus` SDK. Uses Node.js built-in `parseArgs` (Node 18.3+).

---

## Installation

```bash
npm install -g sulcus-cli
# or from source:
git clone ...
cd sulcus/integrations/cli
npm install
npm run build
npm link
```

## Authentication

Set your API key via environment variable:

```bash
export SULCUS_API_KEY=sk-your-key-here
```

Or create `~/.sulcusrc` with either:

- JSON format: `{ "apiKey": "sk-your-key-here" }`
- Plain text: just the key on the first line

Optionally override the server:
```bash
export SULCUS_BASE_URL=https://your-self-hosted-server.example.com
```

---

## Commands

### `sulcus remember`

Store a new memory.

```bash
sulcus remember "User prefers dark mode" --type preference
sulcus remember "Met Alice at the conference" --type episodic
sulcus remember "Always respond in JSON format" --type procedural --namespace agents
sulcus remember "Paris is the capital of France" --type semantic --heat 0.9
```

**Options:**
- `--type, -t` — `episodic | semantic | preference | procedural` (default: `episodic`)
- `--namespace, -n` — namespace (default: `default`)
- `--heat` — initial heat 0–1 (default: `0.8`)

---

### `sulcus search`

Search memories by text query.

```bash
sulcus search "dark mode"
sulcus search "Paris" --limit 5 --type semantic
sulcus search "agent instructions" --namespace agents
```

**Options:**
- `--limit, -l` — max results (default: `10`)
- `--type, -t` — filter by memory type
- `--namespace, -n` — filter by namespace

---

### `sulcus list`

List memories with pagination.

```bash
sulcus list
sulcus list --type preference --pinned
sulcus list --page 2 --page-size 50 --verbose
```

**Options:**
- `--page, -p` — page number (default: `1`)
- `--page-size` — results per page (default: `25`)
- `--type, -t` — filter by memory type
- `--namespace, -n` — filter by namespace
- `--pinned` — only pinned memories
- `--sort` — sort field (default: `current_heat`)
- `--order` — `asc | desc` (default: `desc`)
- `--verbose, -v` — expanded output with all fields

---

### `sulcus forget`

Permanently delete a memory.

```bash
sulcus forget abc123de-...
```

---

### `sulcus pin` / `sulcus unpin`

Pin a memory to prevent heat decay. Unpin to resume decay.

```bash
sulcus pin abc123de-...
sulcus unpin abc123de-...
```

---

### `sulcus whoami`

Show org/tenant info for the current API key.

```bash
sulcus whoami
```

---

### `sulcus export`

Dump all memories to stdout as JSON or CSV.

```bash
# JSON (default)
sulcus export > memories.json

# CSV
sulcus export --format csv > memories.csv

# Filter by namespace
sulcus export --namespace agents --format json
```

**Options:**
- `--format, -f` — `json | csv` (default: `json`)
- `--namespace, -n` — filter by namespace

---

## Heat Model

Sulcus uses a thermodynamic decay model. Each memory has a `current_heat` (0–1):

- High heat → recently accessed / high utility → surfaced first in searches
- Low heat → rarely accessed → decays toward forgetting
- **Pinned** memories are exempt from decay

---

## Development

```bash
npm run build    # compile TypeScript
npm run dev      # watch mode
```

## License

MIT
