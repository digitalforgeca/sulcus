/**
 * sulcus-management-skill.mjs
 *
 * An OpenClaw "skill" that lets the agent subagent itself for Sulcus
 * memory management.  All dispatched tasks run in background tokio threads
 * on the server side; this module returns immediately so the primary agent
 * context is never stalled.
 *
 * Usage:
 *   import { connectSulcus }            from './openclaw-plugin.mjs';
 *   import { SulcusManagementSkill }    from './sulcus-management-skill.mjs';
 *
 *   const client = await connectSulcus({ autoSpawn: true });
 *   const mgmt   = new SulcusManagementSkill(client);
 *
 *   // One-shot: inspect state and fire whichever tasks are needed
 *   const report = await mgmt.assessAndAct();
 *
 *   // Periodic: run full_maintenance every 5 minutes
 *   mgmt.schedulePeriodicMaintenance(5 * 60_000);
 *
 *   // Manual subagent dispatch (mirrors the MCP tool directly)
 *   await mgmt.runSubagent('tick', { decay: 0.9 });
 */

// ── Thresholds that drive autonomous decisions in assessAndAct() ───────────────
const DEFAULTS = {
  // If the active index is this crowded, run a prune before the next tick
  activeIndexPruneThreshold: 40,
  // If fewer than this many nodes are warm, skip prune to preserve context
  activeIndexMinNodes: 5,
  // Heat threshold for node eviction (used in prune_cold_nodes)
  coldNodeThreshold: 0.05,
  // Decay factor forwarded to thermodynamics tick
  decayFactor: 0.85,
  // Default active-index size cap
  activeLimit: 20,
};

export class SulcusManagementSkill {
  /**
   * @param {object} sulcusClient  Result of connectSulcus() from openclaw-plugin.mjs
   * @param {object} [opts]        Override DEFAULTS thresholds
   */
  constructor(sulcusClient, opts = {}) {
    this._client  = sulcusClient;
    this._config  = { ...DEFAULTS, ...opts };
    this._timers  = [];
    this._log     = opts.log ?? ((level, msg, meta) => {
      const ts = new Date().toISOString();
      console.error(`[sulcus-mgmt][${level}] ${ts} ${msg}`, meta ?? '');
    });
  }

  // ── Core primitive ───────────────────────────────────────────────────────────

  /**
   * Dispatch a named background task to Sulcus and return immediately.
   * The Sulcus server runs the task in a detached tokio thread; there is
   * intentionally no blocking poll — fire & forget is the contract.
   *
   * @param {'tick'|'prune_cold_nodes'|'sync'|'full_maintenance'} task
   * @param {object} [args]  Task-specific knobs (decay, threshold, etc.)
   * @returns {{ task_id: string, status: 'dispatched', task: string }}
   */
  async runSubagent(task, args = {}) {
    const res = await this._client.rawSend({
      method: 'tools/call',
      params: {
        name: 'dispatch_background_task',
        arguments: { task, args },
      },
    });

    const inner = this._unwrap(res, 'dispatch_background_task');
    this._log('info', `subagent dispatched`, { task, task_id: inner.task_id });
    return inner;
  }

  // ── Autonomous assessment ─────────────────────────────────────────────────────

  /**
   * Inspect Sulcus metrics and autonomously fire whichever background tasks
   * are warranted.  Returns a report of what was dispatched and why.
   *
   * This is the "subagent loop" entry point.  Call it:
   *   - At the start of an agent session (warm-up)
   *   - After a burst of memory writes (cool-down)
   *   - On a periodic timer to keep the index healthy
   *
   * @returns {{ dispatched: string[], metrics: object, reasoning: string[] }}
   */
  async assessAndAct() {
    const metrics  = await this._metrics();
    const dispatched = [];
    const reasoning  = [];

    const {
      activeIndexPruneThreshold,
      activeIndexMinNodes,
      coldNodeThreshold,
      decayFactor,
      activeLimit,
    } = this._config;

    const {
      active_index_size = 0,
      num_nodes         = 0,
    } = metrics;

    // ── Decision 1: Always run a tick to keep heat current ─────────────────
    reasoning.push(`Tick: standard decay pass (decay=${decayFactor}, nodes=${num_nodes})`);
    await this.runSubagent('tick', {
      decay:           decayFactor,
      prune_threshold: 1.0,
      active_limit:    activeLimit,
    });
    dispatched.push('tick');

    // ── Decision 2: Prune if the active index is bloated ───────────────────
    if (active_index_size > activeIndexPruneThreshold && num_nodes > activeIndexMinNodes) {
      reasoning.push(
        `Prune: active_index (${active_index_size}) exceeds threshold (${activeIndexPruneThreshold})`
      );
      await this.runSubagent('prune_cold_nodes', { threshold: coldNodeThreshold });
      dispatched.push('prune_cold_nodes');
    } else {
      reasoning.push(
        `Prune skipped: active_index=${active_index_size}, min_nodes=${num_nodes}`
      );
    }

    // ── Decision 3: Sync if a server URL is detectable ─────────────────────
    // We do a best-effort sync and let the background task handle missing env
    // gracefully (it logs a warn and exits cleanly when SULCUS_SERVER_URL absent).
    reasoning.push('Sync: dispatching opportunistic push/pull (no-op if server not configured)');
    await this.runSubagent('sync');
    dispatched.push('sync');

    this._log('info', 'assessAndAct complete', { dispatched, metrics });
    return { dispatched, metrics, reasoning };
  }

  // ── Periodic scheduler ───────────────────────────────────────────────────────

  /**
   * Start a background interval that calls assessAndAct() every `intervalMs`.
   * The first assessment fires immediately.
   *
   * @param {number} intervalMs         How often to run (ms). Default: 5 minutes.
   * @param {'assess'|'full_maintenance'} [mode='assess']
   *   'assess'           — use assessAndAct() with adaptive logic
   *   'full_maintenance' — dispatch a single full_maintenance task each interval
   * @returns {() => void}  Call the returned function to stop the scheduler.
   */
  schedulePeriodicMaintenance(intervalMs = 5 * 60_000, mode = 'assess') {
    const tick = async () => {
      try {
        if (mode === 'full_maintenance') {
          await this.runSubagent('full_maintenance', { decay: this._config.decayFactor });
        } else {
          await this.assessAndAct();
        }
      } catch (err) {
        this._log('error', 'periodic maintenance failed', { err: err.message });
      }
    };

    // Fire immediately, then on each interval
    tick();
    const id = setInterval(tick, intervalMs);
    this._timers.push(id);

    this._log('info', `periodic maintenance scheduled`, { intervalMs, mode });

    return () => {
      clearInterval(id);
      this._timers = this._timers.filter(t => t !== id);
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /** Cancel all scheduled timers.  Does NOT close the underlying Sulcus client. */
  shutdown() {
    for (const id of this._timers) clearInterval(id);
    this._timers = [];
    this._log('info', 'SulcusManagementSkill shut down');
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  async _metrics() {
    const res = await this._client.rawSend({
      method: 'tools/call',
      params: { name: 'metrics', arguments: {} },
    });
    return this._unwrap(res, 'metrics');
  }

  _unwrap(res, toolName) {
    const content = res?.result?.content;
    if (!Array.isArray(content) || content.length === 0) {
      throw new Error(`${toolName}: unexpected MCP response shape`);
    }
    const text = content[0].text;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${toolName}: response is not JSON: ${text}`);
    }
  }
}

// ── Convenience factory ───────────────────────────────────────────────────────

/**
 * Attach a SulcusManagementSkill to an existing connectSulcus() client.
 *
 * @param {object} sulcusClient
 * @param {object} [opts]
 * @returns {SulcusManagementSkill}
 */
export function createManagementSkill(sulcusClient, opts = {}) {
  return new SulcusManagementSkill(sulcusClient, opts);
}
