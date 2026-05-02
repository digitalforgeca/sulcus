"use client";

import { useState } from "react";
import {
  TbTargetArrow, TbPlayerPause, TbPlayerPlay,
  TbBell, TbFlame, TbPin, TbTag, TbArrowBounce,
  TbWebhook, TbHash, TbChevronDown, TbChevronUp,
  TbCheck, TbX, TbPlus, TbTrash, TbLoader2,
  TbHistory, TbExternalLink,
} from "react-icons/tb";
import { useTriggers, type Trigger, type CreateTriggerInput } from "@/hooks/useSulcusApi";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_COLORS: Record<string, string> = {
  on_store: "#22c55e",
  on_recall: "#3b82f6",
  on_boost: "#f97316",
  on_decay: "#ef4444",
  on_threshold: "#a855f7",
  on_relate: "#06b6d4",
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
  notify: <TbBell size={11} />,
  boost: <TbFlame size={11} />,
  pin: <TbPin size={11} />,
  tag: <TbTag size={11} />,
  deprecate: <TbArrowBounce size={11} />,
  webhook: <TbWebhook size={11} />,
};

const ACTION_COLORS: Record<string, string> = {
  notify: "#60a5fa",
  boost: "#f97316",
  pin: "#D4AF37",
  tag: "#22c55e",
  deprecate: "#ef4444",
  webhook: "#a855f7",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// AgentTriggers — per-namespace trigger panel for the agents page
// ---------------------------------------------------------------------------

interface AgentTriggersProps {
  namespace: string;
  /** Optional custom header label (e.g. "Global Triggers") */
  globalLabel?: string;
}

export default function AgentTriggers({ namespace, globalLabel }: AgentTriggersProps) {
  const { triggers, triggerHistory, createTrigger, updateTrigger, deleteTrigger } = useTriggers();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  const triggerList = triggers.data?.triggers || [];
  const historyList = triggerHistory.data?.history || [];

  // Filter triggers relevant to this namespace:
  // 1. Triggers owned by this namespace
  // 2. Triggers with filter_namespace matching this agent
  // 3. Global triggers (namespace=default, no filter_namespace) — they fire for everyone
  const relevantTriggers = triggerList.filter(t => {
    if (t.namespace === namespace) return true;
    if (t.filters.namespace === namespace) return true;
    // Global triggers (in default namespace with no namespace filter)
    if (t.namespace === "default" && !t.filters.namespace) return true;
    return false;
  });

  // Filter history for this namespace's triggers
  const relevantHistory = historyList.filter(h => {
    const trigger = triggerList.find(t => t.id === h.trigger_id);
    if (!trigger) return false;
    return relevantTriggers.includes(trigger);
  });

  const handleToggle = (trigger: Trigger) => {
    updateTrigger.mutate({ id: trigger.id, patch: { enabled: !trigger.enabled } });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this trigger?")) return;
    deleteTrigger.mutate(id);
  };

  if (triggers.isLoading) {
    return (
      <div className="p-4 border-t border-[#D4AF37]/10 flex items-center gap-2 text-[#555] text-xs">
        <TbLoader2 size={12} className="animate-spin" /> Loading triggers…
      </div>
    );
  }

  return (
    <div className="border-t border-[#D4AF37]/10 p-5 bg-[#050a0f]/30">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs text-[#888] uppercase tracking-widest flex items-center gap-1.5">
          <TbTargetArrow size={10} className="text-[#D4AF37]" /> {globalLabel || "Triggers"}
          <span className="text-[#555] ml-1">({relevantTriggers.length})</span>
        </h4>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`text-[10px] uppercase tracking-widest px-2 py-1 border rounded-sm transition-colors ${
              showHistory ? "border-[#D4AF37]/40 text-[#D4AF37]" : "border-[#333] text-[#555] hover:text-[#888]"
            }`}
          >
            <TbHistory size={10} className="inline mr-1" /> Log
          </button>
          <Link
            href="/dashboard/triggers"
            className="text-[10px] uppercase tracking-widest px-2 py-1 border border-[#333] text-[#555] hover:text-[#00F0FF] hover:border-[#00F0FF]/40 rounded-sm transition-colors"
          >
            <TbExternalLink size={10} className="inline mr-1" /> Full Page
          </Link>
        </div>
      </div>

      {/* Trigger list */}
      {relevantTriggers.length === 0 ? (
        <div className="text-xs text-[#555] py-3 text-center font-mono">
          No triggers scoped to this agent
        </div>
      ) : (
        <div className="space-y-1.5">
          {relevantTriggers.map(trigger => (
            <div
              key={trigger.id}
              className={`border rounded-sm transition-colors ${
                trigger.enabled ? "border-[#1a2a3a] bg-[#0a1520]" : "border-[#1a2a3a]/50 bg-[#0a1520]/50 opacity-60"
              }`}
            >
              <div className="flex items-center gap-2 p-2.5">
                {/* Toggle */}
                <button
                  onClick={() => handleToggle(trigger)}
                  className={`shrink-0 transition-colors ${
                    trigger.enabled ? "text-[#22c55e] hover:bg-[#22c55e]/10" : "text-[#ef4444] hover:bg-[#ef4444]/10"
                  }`}
                >
                  {trigger.enabled ? <TbPlayerPlay size={12} /> : <TbPlayerPause size={12} />}
                </button>

                {/* Event badge */}
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-widest border shrink-0"
                  style={{
                    borderColor: `${EVENT_COLORS[trigger.event] || "#555"}50`,
                    color: EVENT_COLORS[trigger.event] || "#555",
                  }}
                >
                  {trigger.event.replace("on_", "")}
                </span>

                <span className="text-[#333] text-[10px]">→</span>

                {/* Action badge */}
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-widest border flex items-center gap-1 shrink-0"
                  style={{
                    borderColor: `${ACTION_COLORS[trigger.action] || "#555"}50`,
                    color: ACTION_COLORS[trigger.action] || "#555",
                  }}
                >
                  {ACTION_ICONS[trigger.action]}
                  {trigger.action}
                </span>

                {/* Name */}
                <span className="text-xs text-[#ededed] truncate flex-1">{trigger.name || "Unnamed"}</span>

                {/* Fire count */}
                <span className="text-[10px] text-[#555] font-mono shrink-0">
                  <TbHash size={9} className="inline" />
                  {trigger.fire_count}{trigger.max_fires != null ? `/${trigger.max_fires}` : ""}
                </span>

                {/* Scope indicator */}
                {trigger.namespace !== namespace && (
                  <span className="text-[9px] px-1.5 py-0.5 border border-[#D4AF37]/20 text-[#D4AF37]/60 rounded-sm uppercase tracking-widest shrink-0">
                    global
                  </span>
                )}

                {/* Expand */}
                <button
                  onClick={() => setExpanded(expanded === trigger.id ? null : trigger.id)}
                  className="text-[#555] hover:text-white transition-colors shrink-0"
                >
                  {expanded === trigger.id ? <TbChevronUp size={12} /> : <TbChevronDown size={12} />}
                </button>

                {/* Delete (only for triggers in this namespace) */}
                {trigger.namespace === namespace && (
                  <button
                    onClick={() => handleDelete(trigger.id)}
                    className="text-[#555] hover:text-[#ef4444] transition-colors shrink-0"
                  >
                    <TbTrash size={12} />
                  </button>
                )}
              </div>

              {/* Expanded detail */}
              {expanded === trigger.id && (
                <div className="border-t border-[#1a2a3a] p-3 bg-[#050a0f]/50 space-y-2">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
                    <div>
                      <span className="text-[#555] block uppercase tracking-widest">Cooldown</span>
                      <span className="text-[#ededed] font-mono">{trigger.cooldown_seconds}s</span>
                    </div>
                    <div>
                      <span className="text-[#555] block uppercase tracking-widest">Namespace</span>
                      <span className="text-[#00F0FF] font-mono">{trigger.namespace}</span>
                    </div>
                    <div>
                      <span className="text-[#555] block uppercase tracking-widest">Last Fired</span>
                      <span className="text-[#ededed] font-mono">{trigger.last_fired_at ? timeAgo(trigger.last_fired_at) : "never"}</span>
                    </div>
                    <div>
                      <span className="text-[#555] block uppercase tracking-widest">Created</span>
                      <span className="text-[#ededed] font-mono">{timeAgo(trigger.created_at)}</span>
                    </div>
                  </div>

                  {/* Filters */}
                  {(trigger.filters.memory_type || trigger.filters.namespace || trigger.filters.heat_below != null || trigger.filters.heat_above != null) && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {trigger.filters.memory_type && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-[#1a2a3a] rounded text-[#888]">type: {trigger.filters.memory_type}</span>
                      )}
                      {trigger.filters.namespace && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-[#1a2a3a] rounded text-[#888]">ns: {trigger.filters.namespace}</span>
                      )}
                      {trigger.filters.heat_below != null && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-[#1a2a3a] rounded text-[#888]">heat &lt; {trigger.filters.heat_below}</span>
                      )}
                      {trigger.filters.heat_above != null && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-[#1a2a3a] rounded text-[#888]">heat &gt; {trigger.filters.heat_above}</span>
                      )}
                    </div>
                  )}

                  {/* Action config */}
                  {Object.keys(trigger.action_config).length > 0 && (
                    <pre className="text-[9px] bg-[#050a0f] rounded p-1.5 overflow-x-auto text-[#888] font-mono">
                      {JSON.stringify(trigger.action_config, null, 2)}
                    </pre>
                  )}

                  <div className="text-[9px] text-[#333] font-mono">
                    {trigger.id}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Firing history (inline) */}
      {showHistory && (
        <div className="mt-3 pt-3 border-t border-[#1a2a3a]">
          <h5 className="text-[10px] text-[#555] uppercase tracking-widest mb-2">Recent Fires</h5>
          {relevantHistory.length === 0 ? (
            <div className="text-[10px] text-[#444] font-mono">No fires recorded yet.</div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {relevantHistory.slice(0, 15).map(entry => (
                <div key={entry.id} className="flex items-center gap-2 text-[10px] py-1 px-2 bg-[#0a1520] rounded">
                  <span
                    className="uppercase tracking-widest shrink-0"
                    style={{ color: EVENT_COLORS[entry.event] || "#555" }}
                  >
                    {entry.event.replace("on_", "")}
                  </span>
                  <span className="text-[#333]">→</span>
                  <span
                    className="flex items-center gap-0.5 shrink-0"
                    style={{ color: ACTION_COLORS[entry.action] || "#555" }}
                  >
                    {ACTION_ICONS[entry.action]}
                    {entry.action}
                  </span>
                  {entry.result?.success ? (
                    <TbCheck size={10} className="text-[#22c55e] shrink-0" />
                  ) : (
                    <TbX size={10} className="text-[#ef4444] shrink-0" />
                  )}
                  <span className="text-[#888] truncate flex-1" title={String(entry.result?.message || "")}>
                    {String(entry.result?.message || "").slice(0, 60)}
                  </span>
                  <span className="text-[#444] shrink-0 font-mono">
                    {timeAgo(entry.fired_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
