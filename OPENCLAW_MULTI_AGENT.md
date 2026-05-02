# OpenClaw Multi-Agent Synchronization (SULCUS vMMU)

This guide explains how to configure multiple OpenClaw agent instances to share a central SULCUS Memory Management Unit (vMMU). By syncing to a common SULCUS Enterprise server, agents can collaboratively build and recall from a shared semantic knowledge graph.

## 1. Architectural Overview

The SULCUS system operates on an "Edge-and-Hub" model:
* **The Edge (Local Sidecar):** Each OpenClaw instance runs its own `sulcus` binary. This ensures sub-50ms context building and allows the agent to function completely offline.
* **The Hub (Golden Index):** The `sulcus-server` hosted on your enterprise infrastructure (e.g., Azure). It maintains the cryptographic tenant isolation and global CRDT state.
* **The Sync (HLC-CRDT):** A bi-directional synchronization process (`sync-now`) pushes local operations to the Hub and pulls updates from other agents, merging them using Last-Writer-Wins Hybrid Logical Clocks.

## 2. Configuration (`sulcus.ini`)

On every machine running OpenClaw, create a configuration file at `~/.config/sulcus/sulcus.ini` or pass it via the `SULCUS_CONFIG` environment variable.

```ini
[sulcus]
# The remote enterprise server URL
server_url = http://sulcus.dforge.ca:3000

# Your team's tenant API key
server_api_key = your_tenant_api_key_here

# Thermodynamic tuning (Optional)
decay = 0.85
prune_threshold = 0.05
active_limit = 100
```

## 3. Workflow & Usage

### Step A: Start the Local Sidecar
The local SULCUS process needs to be running to serve the OpenClaw agent.
```bash
SULCUS_CONFIG=/path/to/sulcus.ini ./target/release/sulcus stdio
```
*(Note: OpenClaw will typically spawn this automatically via the MCP integration).*

### Step B: The Synchronization Pass
Memory sharing is **asynchronous**. To share memories with the swarm, you must trigger a sync pass. This can be run as a cron job or a post-run hook.

```bash
SULCUS_CONFIG=/path/to/sulcus.ini ./target/release/sulcus sync-now
```

**What happens during `sync-now`?**
1. **Pull:** The sidecar fetches any new operations from the Golden Index that were created by other agents.
2. **Merge:** The local CRDT engine applies the remote patches, updating the local database.
3. **Push:** The sidecar uploads its local Write-Ahead Log (WAL) to the server.
4. **Compaction:** Successfully synced local ops are compacted to save space.

## 4. Automation Strategies

For enterprise swarms, you should automate the `sync-now` command.

**Crontab Example (Sync every 5 minutes):**
```bash
*/5 * * * * SULCUS_CONFIG=/home/user/sulcus.ini /usr/local/bin/sulcus sync-now >> /var/log/sulcus-sync.log 2>&1
```

**OpenClaw Plugin Hook:**
You can also configure the OpenClaw plugin to run the sync executable during the `agent_end` lifecycle hook.

## 5. Security Note
Your `server_api_key` provides access to the entire tenant's memory pool. **Do not** commit this key to version control. Use environment variables in production (`SULCUS_API_KEY`).
