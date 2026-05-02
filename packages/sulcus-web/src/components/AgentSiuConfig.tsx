'use client';

import { useState, useRef, useCallback } from "react";
import {
  TbBrain, TbCheck, TbRefresh, TbPlus, TbTrash, TbBolt,
  TbAlertTriangle, TbChevronDown, TbSparkles, TbNetwork,
  TbSchool, TbSettings,
} from "react-icons/tb";
import { apiFetch } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentSiuConfig {
  siu_enabled: boolean;
  siu_confidence_threshold: number;
  siu_auto_reclassify: boolean;
  silu_enabled: boolean;
  silu_entity_extraction: boolean;
  silu_classification: boolean;
  silu_training_signals: boolean;
  silu_api_endpoint?: string;
  silu_api_key?: string;
  silu_model?: string;
  type_overrides: Record<string, string>;
}

interface AgentSiuData {
  siu_available: boolean;
  silu_available: boolean;
  effective_config: AgentSiuConfig;
  global_defaults: AgentSiuConfig;
  has_overrides: boolean;
}

const MEMORY_TYPES = ["episodic", "fact", "preference", "procedural", "semantic"] as const;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Toggle({ checked, onChange, label, sublabel }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sublabel?: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div className="relative mt-0.5 shrink-0">
        <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <div className={`w-10 h-5 rounded-full border transition-all duration-200 ${checked ? "bg-[#D4AF37]/25 border-[#D4AF37]" : "bg-[#0a1520] border-[#333]"}`} />
        <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ${checked ? "translate-x-5 bg-[#D4AF37]" : "translate-x-0.5 bg-[#555]"}`} />
      </div>
      <div>
        <span className="text-sm text-[#888] group-hover:text-[#ededed] transition-colors">{label}</span>
        {sublabel && <p className="text-[10px] text-[#555] mt-0.5">{sublabel}</p>}
      </div>
    </label>
  );
}

function ConfigSection({ icon: Icon, title, children }: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-bold text-[#888] uppercase tracking-widest flex items-center gap-1.5">
        <Icon size={12} className="text-[#D4AF37]" /> {title}
      </h4>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function AgentSiuConfig({ namespace }: { namespace: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AgentSiuData | null>(null);
  const [config, setConfig] = useState<AgentSiuConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newOverrideKey, setNewOverrideKey] = useState("");
  const [newOverrideVal, setNewOverrideVal] = useState(MEMORY_TYPES[0] as string);
  const loadedOnce = useRef(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch<AgentSiuData>(`/api/v1/settings/siu/${encodeURIComponent(namespace)}`);
      setData(d);
      setConfig({ ...d.effective_config });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  const handleToggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !loadedOnce.current) {
      loadedOnce.current = true;
      await loadConfig();
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true); setSaved(false); setError(null);
    try {
      await apiFetch(`/api/v1/settings/siu/${encodeURIComponent(namespace)}`, {
        method: "PATCH",
        body: JSON.stringify(config),
      });
      setSaved(true);
      if (data) setData({ ...data, has_overrides: true });
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally { setSaving(false); }
  };

  const handleResetToDefaults = async () => {
    setError(null);
    try {
      await apiFetch(`/api/v1/settings/siu/${encodeURIComponent(namespace)}`, { method: "DELETE" });
      loadedOnce.current = false;
      await loadConfig();
      loadedOnce.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    }
  };

  const update = (patch: Partial<AgentSiuConfig>) => {
    setConfig((c) => c ? { ...c, ...patch } : c);
  };

  const addOverride = () => {
    if (!newOverrideKey.trim() || !config) return;
    update({ type_overrides: { ...config.type_overrides, [newOverrideKey.trim()]: newOverrideVal } });
    setNewOverrideKey("");
    setNewOverrideVal(MEMORY_TYPES[0] as string);
  };

  const removeOverride = (key: string) => {
    if (!config) return;
    const o = { ...config.type_overrides };
    delete o[key];
    update({ type_overrides: o });
  };

  return (
    <div className="border-t border-[#D4AF37]/10">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-[#0d1a28] transition-colors"
      >
        <div className="flex items-center gap-2">
          <TbBrain size={14} className="text-[#D4AF37]" />
          <span className="text-xs font-bold text-[#888] uppercase tracking-widest">Intelligence Configuration</span>
          {data && !loading && (
            <>
              {data.siu_available && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-widest ${
                  config?.siu_enabled ? "text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/30" : "text-amber-400 bg-amber-400/10 border-amber-400/30"
                }`}>
                  SIU {config?.siu_enabled ? "ON" : "OFF"}
                </span>
              )}
              {data.silu_available && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-widest ${
                  config?.silu_enabled ? "text-[#00F0FF] bg-[#00F0FF]/10 border-[#00F0FF]/30" : "text-amber-400 bg-amber-400/10 border-amber-400/30"
                }`}>
                  SILU {config?.silu_enabled ? "ON" : "OFF"}
                </span>
              )}
              {data.has_overrides && (
                <span className="text-[9px] px-1.5 py-0.5 rounded border text-[#D4AF37] bg-[#D4AF37]/10 border-[#D4AF37]/30 uppercase tracking-widest">
                  Custom
                </span>
              )}
            </>
          )}
        </div>
        <TbChevronDown size={14} className={`text-[#555] transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-5">
          {loading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-3 bg-[#050a0f] rounded w-1/3" />
              <div className="h-3 bg-[#050a0f] rounded w-2/3" />
            </div>
          ) : error && !config ? (
            <div className="text-center py-4">
              <TbAlertTriangle size={24} className="text-amber-400/40 mx-auto mb-2" />
              <p className="text-xs text-[#888]">{error}</p>
              <button onClick={loadConfig} className="text-xs text-[#00F0FF] hover:underline mt-2">Retry</button>
            </div>
          ) : config ? (
            <>
              {/* Action bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px]">
                  {saved && <span className="text-[#22c55e] flex items-center gap-1"><TbCheck size={10} /> Saved</span>}
                  {error && <span className="text-red-400 flex items-center gap-1"><TbAlertTriangle size={10} /> {error}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {data?.has_overrides && (
                    <button onClick={handleResetToDefaults} className="text-[10px] text-[#888] hover:text-[#ededed] transition-colors flex items-center gap-1">
                      <TbRefresh size={10} /> Reset to defaults
                    </button>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-3 py-1 text-xs bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] rounded hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* SIU — ONNX classifier */}
                <ConfigSection icon={TbBrain} title="SIU — Local Classifier">
                  <Toggle
                    checked={config.siu_enabled}
                    onChange={(v) => update({ siu_enabled: v })}
                    label="Enable SIU (ONNX model)"
                    sublabel="Fast, free, on-device classification. Trained from SILU signals."
                  />
                  {config.siu_enabled && (
                    <>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-[10px] text-[#888] uppercase tracking-wide">Confidence Threshold</label>
                          <span className="text-xs font-mono text-[#ededed]">{config.siu_confidence_threshold.toFixed(2)}</span>
                        </div>
                        <input
                          type="range" min={0} max={1} step={0.05}
                          value={config.siu_confidence_threshold}
                          onChange={(e) => update({ siu_confidence_threshold: parseFloat(e.target.value) })}
                          className="w-full accent-[#D4AF37]"
                        />
                        <p className="text-[10px] text-[#555] mt-1">Below this confidence, falls back to client-provided type.</p>
                      </div>
                      <Toggle
                        checked={config.siu_auto_reclassify}
                        onChange={(v) => update({ siu_auto_reclassify: v })}
                        label="Auto-reclassify on recall"
                        sublabel="Re-evaluate type on each access using the latest model."
                      />
                    </>
                  )}
                </ConfigSection>

                {/* SILU — LLM teacher */}
                <ConfigSection icon={TbSparkles} title="SILU — LLM Teacher">
                  <Toggle
                    checked={config.silu_enabled}
                    onChange={(v) => update({ silu_enabled: v })}
                    label="Enable SILU pipeline"
                    sublabel="Uses GPT-5.4-nano to classify and extract — trains the SIU model."
                  />
                  {config.silu_enabled && (
                    <div className="space-y-3 pl-1">
                      <Toggle
                        checked={config.silu_entity_extraction}
                        onChange={(v) => update({ silu_entity_extraction: v })}
                        label="Entity extraction"
                        sublabel="Extract entity→relationship→entity triples into the knowledge graph."
                      />
                      <Toggle
                        checked={config.silu_classification}
                        onChange={(v) => update({ silu_classification: v })}
                        label="Memory classification"
                        sublabel="LLM classifies memory type + quality (teacher for SIU)."
                      />
                      <Toggle
                        checked={config.silu_training_signals}
                        onChange={(v) => update({ silu_training_signals: v })}
                        label="Training signal recording"
                        sublabel="Record accept/reclassify signals when SIU and SILU disagree."
                      />

                      {/* BYOK — Bring Your Own Key */}
                      <div className="mt-4 pt-3 border-t border-[#222] space-y-3">
                        <p className="text-[10px] text-[#555] uppercase tracking-widest font-bold flex items-center gap-1.5">
                          <TbNetwork size={10} /> Custom LLM Endpoint (BYOK)
                        </p>
                        <p className="text-[10px] text-[#555]">Bring your own API key for SILU classification. Leave blank to use the default hosted endpoint.</p>
                        <div>
                          <label className="text-[10px] text-[#888] uppercase tracking-wide block mb-1">API Endpoint</label>
                          <input
                            type="text"
                            value={config.silu_api_endpoint || ""}
                            onChange={(e) => update({ silu_api_endpoint: e.target.value || undefined })}
                            placeholder="https://your-resource.openai.azure.com/..."
                            className="w-full bg-[#050a0f] border border-[#333] rounded px-3 py-1.5 text-xs text-[#ededed] placeholder-[#555] focus:border-[#D4AF37]/40 focus:outline-none font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[#888] uppercase tracking-wide block mb-1">API Key</label>
                          <input
                            type="password"
                            value={config.silu_api_key || ""}
                            onChange={(e) => update({ silu_api_key: e.target.value || undefined })}
                            placeholder="sk-... or Azure API key"
                            className="w-full bg-[#050a0f] border border-[#333] rounded px-3 py-1.5 text-xs text-[#ededed] placeholder-[#555] focus:border-[#D4AF37]/40 focus:outline-none font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[#888] uppercase tracking-wide block mb-1">Model</label>
                          <input
                            type="text"
                            value={config.silu_model || ""}
                            onChange={(e) => update({ silu_model: e.target.value || undefined })}
                            placeholder="gpt-5.4-nano (default)"
                            className="w-full bg-[#050a0f] border border-[#333] rounded px-3 py-1.5 text-xs text-[#ededed] placeholder-[#555] focus:border-[#D4AF37]/40 focus:outline-none font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </ConfigSection>
              </div>

              {/* Type Override Rules */}
              <ConfigSection icon={TbSettings} title="Type Override Rules">
                <p className="text-[10px] text-[#555]">Pattern-based overrides — if memory content matches the pattern, force a specific type regardless of SIU/SILU classification.</p>
                {Object.keys(config.type_overrides).length > 0 && (
                  <div className="space-y-1.5">
                    {Object.entries(config.type_overrides).map(([key, val]) => (
                      <div key={key} className="flex items-center gap-2 bg-[#050a0f] border border-[#222] rounded px-3 py-2">
                        <code className="text-[#00F0FF] text-xs flex-1 truncate">{key}</code>
                        <span className="text-[#555] text-xs">→</span>
                        <code className="text-[#D4AF37] text-xs">{val}</code>
                        <button onClick={() => removeOverride(key)} className="text-[#555] hover:text-red-400 transition-colors ml-1">
                          <TbTrash size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="text" value={newOverrideKey} onChange={(e) => setNewOverrideKey(e.target.value)}
                    placeholder="pattern (regex)"
                    className="flex-1 bg-[#050a0f] border border-[#333] rounded px-3 py-1.5 text-xs text-[#ededed] placeholder-[#555] focus:border-[#D4AF37]/40 focus:outline-none font-mono"
                  />
                  <span className="text-[#555] text-xs">→</span>
                  <select
                    value={newOverrideVal} onChange={(e) => setNewOverrideVal(e.target.value)}
                    className="bg-[#050a0f] border border-[#333] rounded px-3 py-1.5 text-xs text-[#ededed] focus:border-[#D4AF37]/40 focus:outline-none font-mono appearance-none"
                  >
                    {MEMORY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button
                    onClick={addOverride} disabled={!newOverrideKey.trim()}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded text-[#D4AF37] text-xs hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40"
                  >
                    <TbPlus size={12} /> Add
                  </button>
                </div>
              </ConfigSection>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
