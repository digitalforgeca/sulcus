"use client";

import { useState, Fragment } from "react";
import {
  TbTargetArrow, TbPlus, TbTrash, TbPlayerPause, TbPlayerPlay,
  TbHistory, TbChevronDown, TbChevronUp, TbFlame, TbPin,
  TbTag, TbBell, TbWebhook, TbArrowBounce, TbPencil,
  TbFilter, TbClock, TbHash, TbCheck, TbX,
} from "react-icons/tb";
import { useTriggers, type Trigger, type CreateTriggerInput } from "@/hooks/useSulcusApi";

// ---- Constants ----

const EVENTS = [
  { value: "on_store", label: "On Store", desc: "When a new memory is created" },
  { value: "on_recall", label: "On Recall", desc: "When a memory is searched/retrieved" },
  { value: "on_boost", label: "On Boost", desc: "When a memory's heat is boosted" },
  { value: "on_decay", label: "On Decay", desc: "When heat drops near zero" },
  { value: "on_threshold", label: "On Threshold", desc: "When heat crosses a boundary" },
  { value: "on_relate", label: "On Relate", desc: "When an edge is created between memories" },
] as const;

const ACTIONS = [
  { value: "notify", label: "Notify", icon: TbBell, desc: "Surface a message to the agent" },
  { value: "boost", label: "Boost", icon: TbFlame, desc: "Increase memory heat" },
  { value: "pin", label: "Pin", icon: TbPin, desc: "Pin the memory (prevent decay)" },
  { value: "tag", label: "Tag", icon: TbTag, desc: "Add a label tag" },
  { value: "deprecate", label: "Deprecate", icon: TbArrowBounce, desc: "Accelerate decay" },
  { value: "webhook", label: "Webhook", icon: TbWebhook, desc: "HTTP callback" },
] as const;

const MEMORY_TYPES = ["episodic", "semantic", "preference", "procedural", "fact", "moment"];

const EVENT_COLORS: Record<string, string> = {
  on_store: "#22c55e",
  on_recall: "#3b82f6",
  on_boost: "#f97316",
  on_decay: "#ef4444",
  on_threshold: "#a855f7",
  on_relate: "#06b6d4",
};

const ACTION_COLORS: Record<string, string> = {
  notify: "#60a5fa",
  boost: "#f97316",
  pin: "#D4AF37",
  tag: "#22c55e",
  deprecate: "#ef4444",
  webhook: "#a855f7",
};

function EventBadge({ event }: { event: string }) {
  const color = EVENT_COLORS[event] || "#888";
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-widest border"
      style={{ borderColor: `${color}50`, color }}
    >
      {event.replace("on_", "")}
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  const color = ACTION_COLORS[action] || "#888";
  const info = ACTIONS.find(a => a.value === action);
  const Icon = info?.icon || TbTargetArrow;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-widest border"
      style={{ borderColor: `${color}50`, color }}
    >
      <Icon size={11} />
      {action}
    </span>
  );
}

// ---- Create Trigger Modal ----

function CreateTriggerForm({ onSubmit, onCancel }: {
  onSubmit: (input: CreateTriggerInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [event, setEvent] = useState("on_store");
  const [action, setAction] = useState("pin");
  const [filterType, setFilterType] = useState("");
  const [filterNamespace, setFilterNamespace] = useState("");
  const [filterPattern, setFilterPattern] = useState("");
  const [filterHeatBelow, setFilterHeatBelow] = useState("");
  const [filterHeatAbove, setFilterHeatAbove] = useState("");
  const [maxFires, setMaxFires] = useState("");
  const [cooldown, setCooldown] = useState("");
  const [actionConfig, setActionConfig] = useState("{}");
  const [showFilters, setShowFilters] = useState(false);

  const handleSubmit = () => {
    const input: CreateTriggerInput = { name, event, action };
    if (description) input.description = description;
    if (filterType) input.filter_memory_type = filterType;
    if (filterNamespace) input.filter_namespace = filterNamespace;
    if (filterPattern) input.filter_label_pattern = filterPattern;
    if (filterHeatBelow) input.filter_heat_below = parseFloat(filterHeatBelow);
    if (filterHeatAbove) input.filter_heat_above = parseFloat(filterHeatAbove);
    if (maxFires) input.max_fires = parseInt(maxFires);
    if (cooldown) input.cooldown_seconds = parseInt(cooldown);
    try { input.action_config = JSON.parse(actionConfig); } catch { /* ignore */ }
    onSubmit(input);
  };

  return (
    <div className="bg-[#0d1c2d] border border-[#D4AF37]/30 rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-medium text-[#D4AF37] flex items-center gap-2">
          <TbPlus size={18} /> New Trigger
        </h3>
        <button onClick={onCancel} className="text-[#555] hover:text-white"><TbX size={18} /></button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] uppercase tracking-widest text-[#555] mb-1 block">Name</label>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. auto-pin-preferences"
            className="w-full bg-[#0a1520] border border-[#1a2a3a] rounded px-3 py-2 text-sm focus:border-[#D4AF37]/50 outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-[#555] mb-1 block">Description</label>
          <input
            value={description} onChange={e => setDescription(e.target.value)}
            placeholder="What this trigger does"
            className="w-full bg-[#0a1520] border border-[#1a2a3a] rounded px-3 py-2 text-sm focus:border-[#D4AF37]/50 outline-none"
          />
        </div>
      </div>

      {/* Event selection */}
      <div>
        <label className="text-[10px] uppercase tracking-widest text-[#555] mb-2 block">When (Event)</label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {EVENTS.map(e => (
            <button
              key={e.value}
              onClick={() => setEvent(e.value)}
              className={`text-left p-2 rounded border text-xs transition-all ${
                event === e.value
                  ? "border-[#D4AF37]/50 bg-[#D4AF37]/10 text-[#D4AF37]"
                  : "border-[#1a2a3a] hover:border-[#333] text-[#888]"
              }`}
            >
              <div className="font-medium">{e.label}</div>
              <div className="text-[10px] text-[#555] mt-0.5">{e.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Action selection */}
      <div>
        <label className="text-[10px] uppercase tracking-widest text-[#555] mb-2 block">Then (Action)</label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {ACTIONS.map(a => {
            const Icon = a.icon;
            return (
              <button
                key={a.value}
                onClick={() => setAction(a.value)}
                className={`text-left p-2 rounded border text-xs transition-all flex items-start gap-2 ${
                  action === a.value
                    ? "border-[#D4AF37]/50 bg-[#D4AF37]/10 text-[#D4AF37]"
                    : "border-[#1a2a3a] hover:border-[#333] text-[#888]"
                }`}
              >
                <Icon size={16} className="mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">{a.label}</div>
                  <div className="text-[10px] text-[#555] mt-0.5">{a.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Action config */}
      {(action === "notify" || action === "boost" || action === "tag" || action === "webhook") && (
        <div>
          <label className="text-[10px] uppercase tracking-widest text-[#555] mb-1 block">
            Action Config {action === "notify" && '(e.g. {"message": "Important memory recalled!"})'}
            {action === "boost" && '(e.g. {"strength": 0.3})'}
            {action === "tag" && '(e.g. {"label": "important"})'}
            {action === "webhook" && '(e.g. {"url": "https://..."})'}
          </label>
          <input
            value={actionConfig} onChange={e => setActionConfig(e.target.value)}
            className="w-full bg-[#0a1520] border border-[#1a2a3a] rounded px-3 py-2 text-sm font-mono focus:border-[#D4AF37]/50 outline-none"
          />
        </div>
      )}

      {/* Filters (collapsible) */}
      <div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 text-xs text-[#888] hover:text-[#D4AF37] transition-colors"
        >
          <TbFilter size={14} />
          Filters {showFilters ? <TbChevronUp size={12} /> : <TbChevronDown size={12} />}
        </button>
        {showFilters && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3 p-3 bg-[#0a1520] rounded border border-[#1a2a3a]">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-[#555] mb-1 block">Memory Type</label>
              <select
                value={filterType} onChange={e => setFilterType(e.target.value)}
                className="w-full bg-[#050a0f] border border-[#1a2a3a] rounded px-2 py-1.5 text-xs"
              >
                <option value="">Any</option>
                {MEMORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-[#555] mb-1 block">Namespace</label>
              <input
                value={filterNamespace} onChange={e => setFilterNamespace(e.target.value)}
                placeholder="e.g. icarus"
                className="w-full bg-[#050a0f] border border-[#1a2a3a] rounded px-2 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-[#555] mb-1 block">Label Pattern</label>
              <input
                value={filterPattern} onChange={e => setFilterPattern(e.target.value)}
                placeholder="e.g. dooley"
                className="w-full bg-[#050a0f] border border-[#1a2a3a] rounded px-2 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-[#555] mb-1 block">Heat Below</label>
              <input type="number" step="0.1" min="0" max="1"
                value={filterHeatBelow} onChange={e => setFilterHeatBelow(e.target.value)}
                className="w-full bg-[#050a0f] border border-[#1a2a3a] rounded px-2 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-[#555] mb-1 block">Heat Above</label>
              <input type="number" step="0.1" min="0" max="1"
                value={filterHeatAbove} onChange={e => setFilterHeatAbove(e.target.value)}
                className="w-full bg-[#050a0f] border border-[#1a2a3a] rounded px-2 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-[#555] mb-1 block">Max Fires</label>
              <input type="number" min="1"
                value={maxFires} onChange={e => setMaxFires(e.target.value)}
                placeholder="∞"
                className="w-full bg-[#050a0f] border border-[#1a2a3a] rounded px-2 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-[#555] mb-1 block">Cooldown (seconds)</label>
              <input type="number" min="0"
                value={cooldown} onChange={e => setCooldown(e.target.value)}
                placeholder="0"
                className="w-full bg-[#050a0f] border border-[#1a2a3a] rounded px-2 py-1.5 text-xs"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-[#888] hover:text-white transition-colors">Cancel</button>
        <button
          onClick={handleSubmit}
          disabled={!name || !event || !action}
          className="px-4 py-2 text-sm bg-[#D4AF37] text-black rounded hover:bg-[#D4AF37]/80 transition-colors disabled:opacity-30"
        >
          Create Trigger
        </button>
      </div>
    </div>
  );
}

// ---- Main Page ----

export default function TriggersPage() {
  const { triggers, triggerHistory, createTrigger, updateTrigger, deleteTrigger } = useTriggers();
  const [showCreate, setShowCreate] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleCreate = (input: CreateTriggerInput) => {
    createTrigger.mutate(input, {
      onSuccess: () => setShowCreate(false),
    });
  };

  const handleToggle = (trigger: Trigger) => {
    updateTrigger.mutate({
      id: trigger.id,
      patch: { enabled: !trigger.enabled },
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this trigger? This also removes its firing history.")) return;
    deleteTrigger.mutate(id);
  };

  const triggerList = triggers.data?.triggers || [];
  const historyList = triggerHistory.data?.history || [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <TbTargetArrow className="text-[#D4AF37]" size={28} />
            Triggers
          </h1>
          <p className="text-sm text-[#555] mt-1">
            Reactive memory automation — set rules, Sulcus enforces them
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`flex items-center gap-2 px-3 py-2 text-xs border rounded transition-colors ${
              showHistory ? "border-[#D4AF37]/50 text-[#D4AF37]" : "border-[#1a2a3a] text-[#888] hover:text-white"
            }`}
          >
            <TbHistory size={14} /> History
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-4 py-2 text-xs bg-[#D4AF37] text-black rounded hover:bg-[#D4AF37]/80 transition-colors"
          >
            <TbPlus size={14} /> New Trigger
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateTriggerForm onSubmit={handleCreate} onCancel={() => setShowCreate(false)} />
      )}

      {/* Trigger list */}
      <div className="space-y-3">
        {triggers.isLoading && <div className="text-[#555] text-sm">Loading triggers...</div>}
        {!triggers.isLoading && triggerList.length === 0 && (
          <div className="bg-[#0d1c2d] border border-[#1a2a3a] rounded-lg p-8 text-center">
            <TbTargetArrow size={40} className="mx-auto text-[#333] mb-3" />
            <p className="text-[#555] text-sm">No triggers yet</p>
            <p className="text-[#444] text-xs mt-1">Create your first trigger to automate memory management</p>
          </div>
        )}
        {triggerList.map(trigger => (
          <div
            key={trigger.id}
            className={`bg-[#0d1c2d] border rounded-lg overflow-hidden transition-colors ${
              trigger.enabled ? "border-[#1a2a3a]" : "border-[#1a2a3a]/50 opacity-60"
            }`}
          >
            {/* Main row */}
            <div className="flex items-center gap-4 p-4">
              {/* Toggle */}
              <button
                onClick={() => handleToggle(trigger)}
                className={`p-1.5 rounded transition-colors ${
                  trigger.enabled ? "text-[#22c55e] hover:bg-[#22c55e]/10" : "text-[#ef4444] hover:bg-[#ef4444]/10"
                }`}
                title={trigger.enabled ? "Disable" : "Enable"}
              >
                {trigger.enabled ? <TbPlayerPlay size={16} /> : <TbPlayerPause size={16} />}
              </button>

              {/* Name + desc */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{trigger.name || "Unnamed"}</span>
                  <EventBadge event={trigger.event} />
                  <span className="text-[#555] text-xs">→</span>
                  <ActionBadge action={trigger.action} />
                </div>
                {trigger.description && (
                  <p className="text-[10px] text-[#555] mt-0.5 truncate">{trigger.description}</p>
                )}
              </div>

              {/* Fire count */}
              <div className="text-right shrink-0">
                <div className="text-xs text-[#888]">
                  <TbHash size={11} className="inline mr-0.5" />
                  {trigger.fire_count}{trigger.max_fires != null ? `/${trigger.max_fires}` : ""}
                </div>
                {trigger.last_fired_at && (
                  <div className="text-[10px] text-[#555]">
                    {new Date(trigger.last_fired_at).toLocaleDateString()}
                  </div>
                )}
              </div>

              {/* Expand / Delete */}
              <button
                onClick={() => setExpandedId(expandedId === trigger.id ? null : trigger.id)}
                className="text-[#555] hover:text-white transition-colors"
              >
                {expandedId === trigger.id ? <TbChevronUp size={16} /> : <TbChevronDown size={16} />}
              </button>
              <button
                onClick={() => handleDelete(trigger.id)}
                className="text-[#555] hover:text-[#ef4444] transition-colors"
              >
                <TbTrash size={16} />
              </button>
            </div>

            {/* Expanded details */}
            {expandedId === trigger.id && (
              <div className="border-t border-[#1a2a3a] p-4 bg-[#0a1520] space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-[#555] block text-[10px] uppercase tracking-widest">Event</span>
                    <span className="text-[#ededed]">{trigger.event}</span>
                  </div>
                  <div>
                    <span className="text-[#555] block text-[10px] uppercase tracking-widest">Action</span>
                    <span className="text-[#ededed]">{trigger.action}</span>
                  </div>
                  <div>
                    <span className="text-[#555] block text-[10px] uppercase tracking-widest">Cooldown</span>
                    <span className="text-[#ededed]">{trigger.cooldown_seconds}s</span>
                  </div>
                  <div>
                    <span className="text-[#555] block text-[10px] uppercase tracking-widest">Namespace</span>
                    <span className="text-[#00F0FF]">{trigger.namespace}</span>
                  </div>
                </div>

                {/* Filters */}
                {(trigger.filters.memory_type || trigger.filters.namespace || trigger.filters.label_pattern || trigger.filters.heat_below || trigger.filters.heat_above) && (
                  <div>
                    <span className="text-[#555] text-[10px] uppercase tracking-widest block mb-1">Filters</span>
                    <div className="flex flex-wrap gap-2">
                      {trigger.filters.memory_type && (
                        <span className="text-[10px] px-2 py-0.5 bg-[#1a2a3a] rounded">type: {trigger.filters.memory_type}</span>
                      )}
                      {trigger.filters.namespace && (
                        <span className="text-[10px] px-2 py-0.5 bg-[#1a2a3a] rounded">ns: {trigger.filters.namespace}</span>
                      )}
                      {trigger.filters.label_pattern && (
                        <span className="text-[10px] px-2 py-0.5 bg-[#1a2a3a] rounded">label: {trigger.filters.label_pattern}</span>
                      )}
                      {trigger.filters.heat_below != null && (
                        <span className="text-[10px] px-2 py-0.5 bg-[#1a2a3a] rounded">heat &lt; {trigger.filters.heat_below}</span>
                      )}
                      {trigger.filters.heat_above != null && (
                        <span className="text-[10px] px-2 py-0.5 bg-[#1a2a3a] rounded">heat &gt; {trigger.filters.heat_above}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Action config */}
                {Object.keys(trigger.action_config).length > 0 && (
                  <div>
                    <span className="text-[#555] text-[10px] uppercase tracking-widest block mb-1">Action Config</span>
                    <pre className="text-[10px] bg-[#050a0f] rounded p-2 overflow-x-auto text-[#888]">
                      {JSON.stringify(trigger.action_config, null, 2)}
                    </pre>
                  </div>
                )}

                <div className="text-[10px] text-[#444]">
                  ID: {trigger.id} | Created: {new Date(trigger.created_at).toLocaleString()}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Firing history */}
      {showHistory && (
        <div className="space-y-3">
          <h2 className="text-lg font-medium flex items-center gap-2 text-[#888]">
            <TbHistory size={18} /> Trigger History
          </h2>
          {triggerHistory.isLoading && <div className="text-[#555] text-sm">Loading...</div>}
          {historyList.length === 0 && !triggerHistory.isLoading && (
            <div className="text-[#555] text-sm">No triggers have fired yet.</div>
          )}
          <div className="space-y-1">
            {historyList.map(entry => (
              <div key={entry.id} className="flex items-center gap-3 p-2 bg-[#0d1c2d] border border-[#1a2a3a] rounded text-xs">
                <EventBadge event={entry.event} />
                <span className="text-[#555]">→</span>
                <ActionBadge action={entry.action} />
                {entry.node_id && (
                  <span className="text-[10px] text-[#555] truncate max-w-[200px]" title={entry.node_id}>
                    node: {entry.node_id.slice(0, 12)}…
                  </span>
                )}
                <span className="ml-auto text-[10px] text-[#555] shrink-0">
                  {new Date(entry.fired_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
