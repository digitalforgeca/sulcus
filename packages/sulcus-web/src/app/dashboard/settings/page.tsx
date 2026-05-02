'use client';

import { useState, useEffect, useCallback } from "react";
import {
  TbSettings,
  TbKey,
  TbPlus,
  TbTrash,
  TbAlertTriangle,
  TbCheck,
  TbCopy,
  TbX,
  TbFlame,
  TbRefresh,
  TbSearch,
} from "react-icons/tb";
import { useApiKeys, useThermoConfig, useRecallAnalytics, type ThermoConfig, type DecayProfile } from "@/hooks/useSulcusApi";
import { apiFetch } from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskKey(hash: string | undefined): string {
  if (!hash) return "••••••••";
  return `••••••••${hash.slice(-8)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Create Key Modal
// ---------------------------------------------------------------------------

interface NewKeyModalProps {
  onClose: () => void;
  onCreated: (key: string) => void;
  isPending: boolean;
  onCreate: (label: string) => void;
}

function CreateKeyModal({ onClose, onCreated, isPending, onCreate }: NewKeyModalProps) {
  const [label, setLabel] = useState("");

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-[#0a1520] border border-[#D4AF37]/20 rounded-lg p-6 w-full max-w-md font-mono">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-[#D4AF37]">Create API Key</h3>
          <button onClick={onClose} className="text-[#888] hover:text-[#ededed]">
            <TbX size={20} />
          </button>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-[#888] block mb-1">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Production key"
              className="w-full bg-[#050a0f] border border-[#222] rounded px-3 py-2 text-sm text-[#ededed] placeholder-[#555] focus:border-[#D4AF37]/40 focus:outline-none"
            />
          </div>
          <button
            disabled={!label.trim() || isPending}
            onClick={() => onCreate(label.trim())}
            className="w-full py-2 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded text-[#D4AF37] text-sm hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create Key"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reveal Key Modal
// ---------------------------------------------------------------------------

interface RevealKeyModalProps {
  apiKey: string;
  onClose: () => void;
}

function RevealKeyModal({ apiKey, onClose }: RevealKeyModalProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-[#0a1520] border border-[#D4AF37]/30 rounded-lg p-6 w-full max-w-lg font-mono">
        <div className="flex items-center gap-2 mb-1">
          <TbKey size={20} className="text-[#D4AF37]" />
          <h3 className="font-bold text-lg text-[#D4AF37]">Your New API Key</h3>
        </div>
        <p className="text-xs text-[#888] mb-4">
          ⚠️ Copy this key now — it will not be shown again.
        </p>
        <div className="bg-[#050a0f] border border-[#D4AF37]/20 rounded p-3 mb-4 flex items-center gap-2 break-all">
          <code className="text-[#00F0FF] text-sm flex-1">{apiKey}</code>
          <button
            onClick={copy}
            className="flex-shrink-0 p-1 text-[#888] hover:text-[#D4AF37] transition-colors"
            title="Copy"
          >
            {copied ? <TbCheck size={16} className="text-[#22c55e]" /> : <TbCopy size={16} />}
          </button>
        </div>
        <button
          onClick={onClose}
          className="w-full py-2 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded text-[#D4AF37] text-sm hover:bg-[#D4AF37]/20 transition-colors"
        >
          I've copied it, close
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm Dialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ title, message, confirmLabel = "Confirm", danger, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-[#0a1520] border border-[#222] rounded-lg p-6 w-full max-w-md font-mono">
        <div className="flex items-center gap-2 mb-2">
          <TbAlertTriangle size={20} className={danger ? "text-red-400" : "text-[#D4AF37]"} />
          <h3 className="font-bold text-lg">{title}</h3>
        </div>
        <p className="text-[#888] text-sm mb-6">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2 border border-[#222] rounded text-[#888] text-sm hover:text-[#ededed] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2 rounded text-sm transition-colors ${
              danger
                ? "bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"
                : "bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] hover:bg-[#D4AF37]/20"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Thermo Helpers
// ---------------------------------------------------------------------------

const MEMORY_TYPES = ["episodic", "semantic", "procedural", "preference", "synthesis"] as const;

const TYPE_LABELS: Record<string, string> = {
  episodic: "Episodic",
  semantic: "Semantic",
  procedural: "Procedural",
  preference: "Preference",
  synthesis: "Synthesis",
};

const TYPE_COLORS: Record<string, string> = {
  episodic: "#a855f7",
  semantic: "#3b82f6",
  procedural: "#22c55e",
  preference: "#f59e0b",
  synthesis: "#06b6d4",
};

function secsToHumanLabel(secs: number): string {
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  if (secs < 2592000) return `${Math.round(secs / 86400)}d`;
  return `${Math.round(secs / 2592000)}mo`;
}

function humanLabelToSecs(label: string): number | null {
  const m = label.match(/^([\d.]+)\s*(m|h|d|mo)$/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  switch (m[2].toLowerCase()) {
    case "m": return v * 60;
    case "h": return v * 3600;
    case "d": return v * 86400;
    case "mo": return v * 2592000;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Decay Profile Editor
// ---------------------------------------------------------------------------

function DecayProfileRow({
  type,
  profile,
  decayMode,
  onChange,
}: {
  type: string;
  profile: DecayProfile;
  decayMode: 'Time' | 'Interaction' | 'Hybrid';
  onChange: (updated: DecayProfile) => void;
}) {
  const color = TYPE_COLORS[type] || "#888";
  const [hlInput, setHlInput] = useState(secsToHumanLabel(profile.half_life_secs));
  const [hiInput, setHiInput] = useState(String(profile.half_life_interactions ?? 100));

  useEffect(() => {
    setHlInput(secsToHumanLabel(profile.half_life_secs));
  }, [profile.half_life_secs]);

  useEffect(() => {
    setHiInput(String(profile.half_life_interactions ?? 100));
  }, [profile.half_life_interactions]);

  const commitHalfLife = useCallback(() => {
    const secs = humanLabelToSecs(hlInput);
    if (secs && secs !== profile.half_life_secs) {
      onChange({ ...profile, half_life_secs: secs });
    } else {
      setHlInput(secsToHumanLabel(profile.half_life_secs));
    }
  }, [hlInput, profile, onChange]);

  const commitInteractions = useCallback(() => {
    const v = parseInt(hiInput);
    if (!isNaN(v) && v > 0 && v !== profile.half_life_interactions) {
      onChange({ ...profile, half_life_interactions: v });
    } else {
      setHiInput(String(profile.half_life_interactions ?? 100));
    }
  }, [hiInput, profile, onChange]);

  const showInteractions = decayMode === 'Interaction' || decayMode === 'Hybrid';

  return (
    <div className="flex items-center gap-3 p-3 border-b border-[#222] last:border-b-0">
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="text-sm font-bold w-24 flex-shrink-0">{TYPE_LABELS[type]}</span>

      <div className="flex items-center gap-2 flex-1">
        <label className="text-[10px] text-[#888] uppercase tracking-wide w-16 text-right">Half-life</label>
        <input
          value={hlInput}
          onChange={(e) => setHlInput(e.target.value)}
          onBlur={commitHalfLife}
          onKeyDown={(e) => e.key === "Enter" && commitHalfLife()}
          className="bg-[#050a0f] border border-[#333] rounded px-2 py-1 text-xs text-[#ededed] w-16 text-center font-mono"
        />
        {showInteractions && (
          <>
            <label className="text-[10px] text-[#888] uppercase tracking-wide">Interactions</label>
            <input
              value={hiInput}
              onChange={(e) => setHiInput(e.target.value)}
              onBlur={commitInteractions}
              onKeyDown={(e) => e.key === "Enter" && commitInteractions()}
              className="bg-[#050a0f] border border-[#333] rounded px-2 py-1 text-xs text-[#ededed] w-16 text-center font-mono"
            />
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[10px] text-[#888] uppercase tracking-wide">Floor</label>
        <input
          type="range"
          min={0}
          max={0.3}
          step={0.01}
          value={profile.floor}
          onChange={(e) => onChange({ ...profile, floor: parseFloat(e.target.value) })}
          className="w-16 accent-[#D4AF37]"
        />
        <span className="text-[10px] text-[#888] font-mono w-8">{profile.floor.toFixed(2)}</span>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[10px] text-[#888] uppercase tracking-wide">Stab+</label>
        <input
          type="range"
          min={1}
          max={3}
          step={0.1}
          value={profile.stability_gain}
          onChange={(e) => onChange({ ...profile, stability_gain: parseFloat(e.target.value) })}
          className="w-16 accent-[#D4AF37]"
        />
        <span className="text-[10px] text-[#888] font-mono w-8">{profile.stability_gain.toFixed(1)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { apiKeys, createKey, revokeKey } = useApiKeys();
  const { thermoConfig, updateThermoConfig } = useThermoConfig();
  const recallAnalytics = useRecallAnalytics();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearDone, setClearDone] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [thermoEdits, setThermoEdits] = useState<ThermoConfig | null>(null);
  const [thermoSaving, setThermoSaving] = useState(false);
  const [thermoSaved, setThermoSaved] = useState(false);

  // Initialize edits from server config
  useEffect(() => {
    if (thermoConfig.data?.config && !thermoEdits) {
      setThermoEdits(structuredClone(thermoConfig.data.config));
    }
  }, [thermoConfig.data, thermoEdits]);

  const thermoIsDirty =
    thermoEdits &&
    thermoConfig.data?.config &&
    JSON.stringify(thermoEdits) !== JSON.stringify(thermoConfig.data.config);

  const handleThermoSave = async () => {
    if (!thermoEdits) return;
    setThermoSaving(true);
    setThermoSaved(false);
    try {
      await updateThermoConfig.mutateAsync(thermoEdits);
      setThermoSaved(true);
      setTimeout(() => setThermoSaved(false), 3000);
    } finally {
      setThermoSaving(false);
    }
  };

  const handleThermoReset = () => {
    if (thermoConfig.data?.defaults) {
      setThermoEdits(structuredClone(thermoConfig.data.defaults));
    }
  };

  const updateDecayProfile = (type: string, updated: DecayProfile) => {
    if (!thermoEdits) return;
    setThermoEdits({
      ...thermoEdits,
      decay_profiles: { ...thermoEdits.decay_profiles, [type]: updated },
    });
  };

  const handleCreate = (label: string) => {
    createKey.mutate(label, {
      onSuccess: (result) => {
        setShowCreateModal(false);
        setNewKeyValue(result.key);
      },
    });
  };

  const handleRevoke = (id: string) => {
    revokeKey.mutate(id, {
      onSuccess: () => setRevokeTarget(null),
    });
  };

  const handleClearAll = async () => {
    setClearConfirm(false);
    setClearError(null);
    try {
      await apiFetch("/api/v1/agent/nodes/bulk", { method: "POST", body: JSON.stringify({ delete_all: true }) });
      setClearDone(true);
    } catch (err) {
      setClearError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  return (
    <div className="font-mono text-[#ededed] ">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <TbSettings size={28} className="text-[#D4AF37]" />
        <h1 className="text-2xl font-bold tracking-wide">Settings</h1>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Section 1: API Keys                                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-[#888] tracking-widest uppercase">API Keys</h2>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded text-[#D4AF37] text-xs hover:bg-[#D4AF37]/20 transition-colors"
          >
            <TbPlus size={14} />
            Create New Key
          </button>
        </div>

        <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden">
          {apiKeys.isLoading && (
            Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4 border-b border-[#222] animate-pulse last:border-b-0">
                <div className="h-3 flex-1 bg-[#050a0f] rounded" />
                <div className="h-3 w-24 bg-[#050a0f] rounded" />
              </div>
            ))
          )}

          {!apiKeys.isLoading && (!apiKeys.data || apiKeys.data.length === 0) && (
            <div className="p-8 text-center text-[#888] text-sm">
              No API keys yet. Create one to authenticate with the Sulcus API.
            </div>
          )}

          {apiKeys.data?.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between gap-4 p-4 border-b border-[#222] last:border-b-0"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm truncate">{key.label || 'API Key'}</span>
                  <span className="text-xs bg-[#D4AF37]/10 text-[#D4AF37] px-2 py-0.5 rounded border border-[#D4AF37]/20">
                    {key.plan_tier}
                  </span>
                </div>
                <code className="text-xs text-[#888]">{key.prefix ? `${key.prefix}••••••••` : key.id.slice(0, 8) + '••••••••'}</code>
                <span className="text-xs text-[#555]">Created {formatDate(key.created_at)}{key.last_used_at ? ` · Last used ${formatDate(key.last_used_at)}` : ''}</span>
              </div>
              <button
                onClick={() => setRevokeTarget(key.id)}
                className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 border border-red-500/20 rounded text-red-400 text-xs hover:bg-red-500/10 transition-colors"
              >
                <TbTrash size={12} />
                Revoke
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Section 2: Thermodynamic Engine                                     */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TbFlame size={16} className="text-[#D4AF37]" />
            <h2 className="text-sm font-bold text-[#888] tracking-widest uppercase">Thermodynamic Engine</h2>
            {thermoConfig.data?.custom && (
              <span className="text-[10px] bg-[#D4AF37]/10 text-[#D4AF37] px-2 py-0.5 rounded border border-[#D4AF37]/20">
                Custom
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {thermoSaved && (
              <span className="text-xs text-[#22c55e] flex items-center gap-1">
                <TbCheck size={12} /> Saved
              </span>
            )}
            <button
              onClick={handleThermoReset}
              className="text-xs text-[#888] hover:text-[#ededed] transition-colors"
              title="Reset to defaults"
            >
              <TbRefresh size={14} />
            </button>
            <button
              onClick={handleThermoSave}
              disabled={!thermoIsDirty || thermoSaving}
              className="px-3 py-1 text-xs bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] rounded hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {thermoSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {thermoConfig.isLoading && (
          <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg p-8 animate-pulse">
            <div className="h-3 bg-[#050a0f] rounded w-1/3 mb-4" />
            <div className="h-3 bg-[#050a0f] rounded w-2/3" />
          </div>
        )}

        {!thermoConfig.isLoading && thermoConfig.isError && (
          <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg p-8 text-center">
            <p className="text-[#888] text-sm mb-2">Unable to load thermodynamic configuration.</p>
            <p className="text-[#555] text-xs">Connect via the Sulcus sidecar to configure memory decay settings.</p>
          </div>
        )}

        {!thermoConfig.isLoading && !thermoConfig.isError && !thermoEdits && (
          <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg p-8 text-center">
            <p className="text-[#888] text-sm">Coming soon — configure thermodynamic decay profiles here.</p>
          </div>
        )}

        {thermoEdits && (
          <>
            {/* Decay Mode */}
            <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden mb-4">
              <div className="p-3 border-b border-[#222] flex items-center gap-2">
                <TbFlame size={14} className="text-[#D4AF37]" />
                <h3 className="text-xs font-bold text-[#888] uppercase tracking-widest">Decay Mode</h3>
              </div>
              <div className="p-4 flex gap-3">
                {(['Time', 'Interaction', 'Hybrid'] as const).map((mode) => {
                  const desc = mode === 'Time' ? 'Wall-clock decay (original)' : mode === 'Interaction' ? 'Decays only during agent activity' : 'Both — whichever is faster';
                  const active = thermoEdits.decay_mode === mode;
                  return (
                    <button
                      key={mode}
                      onClick={() => setThermoEdits({ ...thermoEdits, decay_mode: mode })}
                      className={`flex-1 p-3 rounded border text-left transition-colors ${active ? 'border-[#D4AF37]/50 bg-[#D4AF37]/10' : 'border-[#222] hover:border-[#D4AF37]/20'}`}
                    >
                      <span className={`text-xs font-bold block mb-1 ${active ? 'text-[#D4AF37]' : 'text-[#ededed]'}`}>{mode}</span>
                      <span className="text-[10px] text-[#555]">{desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Decay Profiles */}
            <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden mb-4">
              <div className="p-3 border-b border-[#222]">
                <h3 className="text-xs font-bold text-[#888] uppercase tracking-widest">Decay Profiles</h3>
                <p className="text-[10px] text-[#555] mt-1">How fast each memory type cools. Half-life sets the time to reach 50% heat.</p>
              </div>
              {MEMORY_TYPES.map((type) =>
                thermoEdits.decay_profiles[type] ? (
                  <DecayProfileRow
                    key={type}
                    type={type}
                    profile={thermoEdits.decay_profiles[type]}
                    decayMode={thermoEdits.decay_mode}
                    onChange={(updated) => updateDecayProfile(type, updated)}
                  />
                ) : null
              )}
            </div>

            {/* Recall Weights */}
            <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden mb-4">
              <div className="p-3 border-b border-[#222] flex items-center gap-2">
                <TbSearch size={14} className="text-[#D4AF37]" />
                <h3 className="text-xs font-bold text-[#888] uppercase tracking-widest">Recall Weights</h3>
              </div>
              <div className="p-4">
                <p className="text-[10px] text-[#555] mb-4">Controls how search results are ranked. Higher similarity weight favors relevant memories; higher heat weight favors recently active ones.</p>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] text-[#888] uppercase tracking-wide">Similarity Weight</label>
                      <span className="text-xs font-mono text-[#888]">{(thermoEdits.recall?.similarity_weight ?? 0.7).toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={thermoEdits.recall?.similarity_weight ?? 0.7}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setThermoEdits({ ...thermoEdits, recall: { similarity_weight: v, heat_weight: Math.round((1 - v) * 100) / 100 } });
                      }}
                      className="w-full accent-[#D4AF37]"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] text-[#888] uppercase tracking-wide">Heat Weight</label>
                      <span className="text-xs font-mono text-[#888]">{(thermoEdits.recall?.heat_weight ?? 0.3).toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={thermoEdits.recall?.heat_weight ?? 0.3}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setThermoEdits({ ...thermoEdits, recall: { heat_weight: v, similarity_weight: Math.round((1 - v) * 100) / 100 } });
                      }}
                      className="w-full accent-[#D4AF37]"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Resonance */}
            <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden mb-4">
              <div className="p-3 border-b border-[#222]">
                <h3 className="text-xs font-bold text-[#888] uppercase tracking-widest">Resonance</h3>
                <p className="text-[10px] text-[#555] mt-1">How heat spreads between connected memories.</p>
              </div>
              <div className="grid grid-cols-2 gap-4 p-4">
                <div>
                  <label className="text-[10px] text-[#888] uppercase tracking-wide block mb-1">Spread Factor</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={thermoEdits.resonance.spread_factor}
                      onChange={(e) =>
                        setThermoEdits({
                          ...thermoEdits,
                          resonance: { ...thermoEdits.resonance, spread_factor: parseFloat(e.target.value) },
                        })
                      }
                      className="flex-1 accent-[#D4AF37]"
                    />
                    <span className="text-xs font-mono text-[#888] w-8">{thermoEdits.resonance.spread_factor.toFixed(2)}</span>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-[#888] uppercase tracking-wide block mb-1">Damping</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={thermoEdits.resonance.damping}
                      onChange={(e) =>
                        setThermoEdits({
                          ...thermoEdits,
                          resonance: { ...thermoEdits.resonance, damping: parseFloat(e.target.value) },
                        })
                      }
                      className="flex-1 accent-[#D4AF37]"
                    />
                    <span className="text-xs font-mono text-[#888] w-8">{thermoEdits.resonance.damping.toFixed(2)}</span>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-[#888] uppercase tracking-wide block mb-1">Depth (hops)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={thermoEdits.resonance.depth}
                      onChange={(e) =>
                        setThermoEdits({
                          ...thermoEdits,
                          resonance: { ...thermoEdits.resonance, depth: parseInt(e.target.value) },
                        })
                      }
                      className="flex-1 accent-[#D4AF37]"
                    />
                    <span className="text-xs font-mono text-[#888] w-8">{thermoEdits.resonance.depth}</span>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-[#888] uppercase tracking-wide block mb-1">Thermal Gate</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={0.5}
                      step={0.01}
                      value={thermoEdits.resonance.thermal_gate}
                      onChange={(e) =>
                        setThermoEdits({
                          ...thermoEdits,
                          resonance: { ...thermoEdits.resonance, thermal_gate: parseFloat(e.target.value) },
                        })
                      }
                      className="flex-1 accent-[#D4AF37]"
                    />
                    <span className="text-xs font-mono text-[#888] w-8">{thermoEdits.resonance.thermal_gate.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Consolidation + Active Index */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden">
                <div className="p-3 border-b border-[#222]">
                  <h3 className="text-xs font-bold text-[#888] uppercase tracking-widest">Consolidation</h3>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="text-[10px] text-[#888] uppercase tracking-wide block mb-1">Cold Threshold</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0.01}
                        max={0.5}
                        step={0.01}
                        value={thermoEdits.consolidation.cold_threshold}
                        onChange={(e) =>
                          setThermoEdits({
                            ...thermoEdits,
                            consolidation: { ...thermoEdits.consolidation, cold_threshold: parseFloat(e.target.value) },
                          })
                        }
                        className="flex-1 accent-[#D4AF37]"
                      />
                      <span className="text-xs font-mono text-[#888] w-8">{thermoEdits.consolidation.cold_threshold.toFixed(2)}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888] uppercase tracking-wide block mb-1">Cold Count Trigger</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={5}
                        max={100}
                        step={5}
                        value={thermoEdits.consolidation.cold_count_trigger}
                        onChange={(e) =>
                          setThermoEdits({
                            ...thermoEdits,
                            consolidation: { ...thermoEdits.consolidation, cold_count_trigger: parseInt(e.target.value) },
                          })
                        }
                        className="flex-1 accent-[#D4AF37]"
                      />
                      <span className="text-xs font-mono text-[#888] w-8">{thermoEdits.consolidation.cold_count_trigger}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden">
                <div className="p-3 border-b border-[#222]">
                  <h3 className="text-xs font-bold text-[#888] uppercase tracking-widest">Active Index</h3>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="text-[10px] text-[#888] uppercase tracking-wide block mb-1">Max Nodes</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={10}
                        max={200}
                        step={10}
                        value={thermoEdits.active_index.max_nodes}
                        onChange={(e) =>
                          setThermoEdits({
                            ...thermoEdits,
                            active_index: { ...thermoEdits.active_index, max_nodes: parseInt(e.target.value) },
                          })
                        }
                        className="flex-1 accent-[#D4AF37]"
                      />
                      <span className="text-xs font-mono text-[#888] w-8">{thermoEdits.active_index.max_nodes}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888] uppercase tracking-wide block mb-1">Context Budget</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={2000}
                        max={50000}
                        step={1000}
                        value={thermoEdits.active_index.context_budget_chars}
                        onChange={(e) =>
                          setThermoEdits({
                            ...thermoEdits,
                            active_index: { ...thermoEdits.active_index, context_budget_chars: parseInt(e.target.value) },
                          })
                        }
                        className="flex-1 accent-[#D4AF37]"
                      />
                      <span className="text-xs font-mono text-[#888] w-8">{(thermoEdits.active_index.context_budget_chars / 1000).toFixed(0)}k</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recall Analytics Summary */}
            {recallAnalytics.data && recallAnalytics.data.stats.length > 0 && (
              <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden mb-4">
                <div className="p-3 border-b border-[#222]">
                  <h3 className="text-xs font-bold text-[#888] uppercase tracking-widest">Recall Quality ({recallAnalytics.data.period})</h3>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-5 gap-2">
                    {recallAnalytics.data.stats.map((stat) => (
                      <div key={stat.memory_type} className="text-center">
                        <span
                          className="text-xs font-bold block mb-1"
                          style={{ color: TYPE_COLORS[stat.memory_type] || "#888" }}
                        >
                          {TYPE_LABELS[stat.memory_type] || stat.memory_type}
                        </span>
                        <span className="text-lg font-mono text-[#ededed]">
                          {(stat.relevance_ratio * 100).toFixed(0)}%
                        </span>
                        <span className="text-[10px] text-[#555] block">{stat.total_recalls} recalls</span>
                      </div>
                    ))}
                  </div>
                  {recallAnalytics.data.suggestions.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[#222]">
                      <p className="text-[10px] text-[#888] uppercase tracking-widest mb-1">Suggestions</p>
                      {recallAnalytics.data.suggestions.map((s, i) => (
                        <p key={i} className="text-xs text-[#D4AF37] mt-1">{s}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Section 3: Danger Zone                                              */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="text-sm font-bold text-red-500/70 tracking-widest uppercase mb-4">Danger Zone</h2>
        <div className="border border-red-500/20 rounded-lg p-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="font-bold text-sm text-red-400 mb-1">Clear All Memories</p>
              <p className="text-xs text-[#888]">
                Permanently delete all memory nodes from your graph. This action cannot be undone.
              </p>
              {clearDone && (
                <p className="text-xs text-[#22c55e] mt-2 flex items-center gap-1">
                  <TbCheck size={14} /> All memories cleared.
                </p>
              )}
              {clearError && (
                <p className="text-xs text-red-400 mt-2">{clearError}</p>
              )}
            </div>
            <button
              onClick={() => setClearConfirm(true)}
              disabled={clearDone}
              className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border border-red-500/30 rounded text-red-400 text-sm hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              <TbTrash size={14} />
              Clear All
            </button>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Modals / Dialogs                                                    */}
      {/* ------------------------------------------------------------------ */}

      {showCreateModal && (
        <CreateKeyModal
          onClose={() => setShowCreateModal(false)}
          onCreated={setNewKeyValue}
          isPending={createKey.isPending}
          onCreate={handleCreate}
        />
      )}

      {newKeyValue && (
        <RevealKeyModal apiKey={newKeyValue} onClose={() => setNewKeyValue(null)} />
      )}

      {revokeTarget && (
        <ConfirmDialog
          title="Revoke API Key"
          message="Are you sure you want to revoke this key? Any services using it will lose access immediately."
          confirmLabel="Revoke"
          danger
          onConfirm={() => handleRevoke(revokeTarget)}
          onCancel={() => setRevokeTarget(null)}
        />
      )}

      {clearConfirm && (
        <ConfirmDialog
          title="Clear All Memories"
          message="This will permanently delete ALL memory nodes from your graph. This cannot be undone. Are you absolutely sure?"
          confirmLabel="Yes, clear all"
          danger
          onConfirm={handleClearAll}
          onCancel={() => setClearConfirm(false)}
        />
      )}
    </div>
  );
}
