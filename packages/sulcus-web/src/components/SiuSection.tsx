'use client';

import { useState, useRef } from "react";
import {
  TbBrain, TbCheck, TbRefresh, TbPlus, TbTrash, TbBolt, TbAlertTriangle, TbChevronDown,
} from "react-icons/tb";
import { apiFetch } from "@/lib/api";

interface SiuConfig {
  enabled: boolean;
  confidence_threshold: number;
  auto_reclassify: boolean;
  extract_details: boolean;
  type_overrides: Record<string, string>;
}

const DEFAULT_CONFIG: SiuConfig = {
  enabled: true,
  confidence_threshold: 0.7,
  auto_reclassify: false,
  extract_details: true,
  type_overrides: {},
};

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div className="relative">
        <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <div className={`w-10 h-5 rounded-full border transition-all duration-200 ${checked ? "bg-[#D4AF37]/25 border-[#D4AF37]" : "bg-[#0a1520] border-[#333]"}`} />
        <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ${checked ? "translate-x-5 bg-[#D4AF37]" : "translate-x-0.5 bg-[#555]"}`} />
      </div>
      <span className="text-sm text-[#888] group-hover:text-[#ededed] transition-colors">{label}</span>
    </label>
  );
}

export default function SiuSection() {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gated, setGated] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [config, setConfig] = useState<SiuConfig>(DEFAULT_CONFIG);
  const [defaults, setDefaults] = useState<SiuConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newOverrideKey, setNewOverrideKey] = useState("");
  const [newOverrideVal, setNewOverrideVal] = useState("");
  const loadedOnce = useRef(false);

  // Load ONLY when user expands — no useEffect, no auto-fetch
  const handleToggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !loadedOnce.current) {
      loadedOnce.current = true;
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<{ config?: Partial<SiuConfig>; defaults?: Partial<SiuConfig>; siu_available?: boolean }>("/api/v1/settings/siu");
        // Server may return partial config — merge with defaults to ensure all fields exist
        const mergedConfig: SiuConfig = { ...DEFAULT_CONFIG, ...data.config, type_overrides: { ...DEFAULT_CONFIG.type_overrides, ...(data.config?.type_overrides ?? {}) } };
        const mergedDefaults: SiuConfig = { ...DEFAULT_CONFIG, ...data.defaults, type_overrides: { ...DEFAULT_CONFIG.type_overrides, ...(data.defaults?.type_overrides ?? {}) } };
        setConfig(mergedConfig);
        setDefaults(mergedDefaults);
        setGated(false);
        setUnavailable(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (msg.includes("403")) {
          setGated(true);
        } else if (msg.includes("404")) {
          // Endpoint doesn't exist on server yet — not an error, just not available
          setUnavailable(true);
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    }
  };

  const handleSave = async () => {
    setSaving(true); setSaved(false); setError(null);
    try {
      await apiFetch("/api/v1/settings/siu", { method: "PATCH", body: JSON.stringify(config) });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally { setSaving(false); }
  };

  const addOverride = () => {
    if (!newOverrideKey.trim()) return;
    setConfig((c) => ({ ...c, type_overrides: { ...c.type_overrides, [newOverrideKey.trim()]: newOverrideVal.trim() } }));
    setNewOverrideKey(""); setNewOverrideVal("");
  };

  const removeOverride = (key: string) => {
    setConfig((c) => { const o = { ...c.type_overrides }; delete o[key]; return { ...c, type_overrides: o }; });
  };

  return (
    <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden mt-8">
      {/* Collapsible Header */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-[#0a1520]/80 transition-colors"
      >
        <div className="flex items-center gap-3">
          <TbBrain size={22} className="text-[#D4AF37]" />
          <h2 className="text-lg font-bold tracking-wide">SIU Classifier</h2>
          {!loading && !gated && !unavailable && expanded && (
            <span className={`flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded border uppercase tracking-widest ${
              config.enabled ? "text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/30" : "text-amber-400 bg-amber-400/10 border-amber-400/30"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${config.enabled ? "bg-[#22c55e] animate-pulse" : "bg-amber-400"}`} />
              {config.enabled ? "Active" : "Inactive"}
            </span>
          )}
        </div>
        <TbChevronDown size={18} className={`text-[#555] transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="border-t border-[#222]">
          {loading ? (
            <div className="p-6 animate-pulse"><div className="h-3 bg-[#050a0f] rounded w-1/3 mb-4" /><div className="h-3 bg-[#050a0f] rounded w-2/3" /></div>
          ) : gated ? (
            /* Gated — upgrade prompt */
            <div className="p-6 text-center">
              <TbBolt size={32} className="text-[#D4AF37]/40 mx-auto mb-3" />
              <p className="text-[#888] text-sm mb-4">Upgrade to Neuron plan or higher to unlock the SIU classifier.</p>
              <a href="https://sulcus.ca/pricing" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded text-[#D4AF37] text-xs hover:bg-[#D4AF37]/20 transition-colors">
                <TbBolt size={14} /> Upgrade to Neuron
              </a>
            </div>
          ) : unavailable ? (
            /* Endpoint not deployed yet */
            <div className="p-6 text-center">
              <TbBrain size={32} className="text-[#555]/40 mx-auto mb-3" />
              <p className="text-[#888] text-sm">SIU classifier endpoint not yet available on this server.</p>
              <p className="text-[#555] text-xs mt-2">This feature is coming soon.</p>
            </div>
          ) : (
            <>
              {/* Actions bar */}
              <div className="flex items-center justify-end gap-2 px-4 pt-3">
                {saved && <span className="text-xs text-[#22c55e] flex items-center gap-1"><TbCheck size={12} /> Saved</span>}
                {error && <span className="text-xs text-red-400 flex items-center gap-1"><TbAlertTriangle size={12} /> {error}</span>}
                <button onClick={() => setConfig({ ...defaults })} className="text-xs text-[#888] hover:text-[#ededed] transition-colors p-1" title="Reset to defaults"><TbRefresh size={14} /></button>
                <button onClick={handleSave} disabled={saving}
                  className="px-3 py-1 text-xs bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] rounded hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40">
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>

              {/* Controls */}
              <div className="p-5 space-y-5">
                <Toggle checked={config.enabled} onChange={(v) => setConfig((c) => ({ ...c, enabled: v }))} label="Enable SIU classifier (replaces regex heuristic)" />
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] text-[#888] uppercase tracking-wide">Confidence Threshold</label>
                    <span className="text-xs font-mono text-[#ededed]">{config.confidence_threshold.toFixed(2)}</span>
                  </div>
                  <input type="range" min={0} max={1} step={0.05} value={config.confidence_threshold}
                    onChange={(e) => setConfig((c) => ({ ...c, confidence_threshold: parseFloat(e.target.value) }))}
                    className="w-full accent-[#D4AF37]" />
                  <p className="text-[10px] text-[#555] mt-1">Below this confidence, falls back to regex heuristic.</p>
                </div>
                <Toggle checked={config.auto_reclassify} onChange={(v) => setConfig((c) => ({ ...c, auto_reclassify: v }))} label="Auto-reclassify on next access" />
                <Toggle checked={config.extract_details} onChange={(v) => setConfig((c) => ({ ...c, extract_details: v }))} label="Extract and store derived details" />
              </div>

              {/* Type Overrides */}
              <div className="border-t border-[#222] p-4">
                <h3 className="text-xs font-bold text-[#888] uppercase tracking-widest mb-3">Type Override Rules</h3>
                {Object.keys(config.type_overrides).length === 0 ? (
                  <p className="text-[#555] text-xs py-1">No overrides — using default classification.</p>
                ) : (
                  <div className="space-y-1.5 mb-3">
                    {Object.entries(config.type_overrides).map(([key, val]) => (
                      <div key={key} className="flex items-center gap-2 bg-[#050a0f] border border-[#222] rounded px-3 py-2">
                        <code className="text-[#00F0FF] text-xs flex-1">{key}</code>
                        <span className="text-[#555] text-xs">→</span>
                        <code className="text-[#D4AF37] text-xs flex-1">{val}</code>
                        <button onClick={() => removeOverride(key)} className="text-[#555] hover:text-red-400 transition-colors"><TbTrash size={13} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input type="text" value={newOverrideKey} onChange={(e) => setNewOverrideKey(e.target.value)} placeholder="pattern"
                    className="flex-1 bg-[#050a0f] border border-[#333] rounded px-3 py-1.5 text-xs text-[#ededed] placeholder-[#555] focus:border-[#D4AF37]/40 focus:outline-none font-mono" />
                  <span className="text-[#555] text-xs">→</span>
                  <input type="text" value={newOverrideVal} onChange={(e) => setNewOverrideVal(e.target.value)} placeholder="memory_type"
                    className="flex-1 bg-[#050a0f] border border-[#333] rounded px-3 py-1.5 text-xs text-[#ededed] placeholder-[#555] focus:border-[#D4AF37]/40 focus:outline-none font-mono"
                    onKeyDown={(e) => e.key === "Enter" && addOverride()} />
                  <button onClick={addOverride} disabled={!newOverrideKey.trim()}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded text-[#D4AF37] text-xs hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40">
                    <TbPlus size={12} /> Add
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
