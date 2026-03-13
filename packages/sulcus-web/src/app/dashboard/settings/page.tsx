'use client';

import { useState } from "react";
import {
  TbSettings,
  TbKey,
  TbPlus,
  TbTrash,
  TbAlertTriangle,
  TbCheck,
  TbCopy,
  TbX,
} from "react-icons/tb";
import { useSulcusApi } from "@/hooks/useSulcusApi";
import { apiFetch } from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskKey(hash: string): string {
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

export default function SettingsPage() {
  const { apiKeys, createKey, revokeKey } = useSulcusApi();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearDone, setClearDone] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

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
      await apiFetch("/api/v1/agent/nodes/bulk", { method: "DELETE" });
      setClearDone(true);
    } catch (err) {
      setClearError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  return (
    <div className="font-mono text-[#ededed] max-w-3xl">
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
                  <span className="font-bold text-sm truncate">{key.org_name}</span>
                  <span className="text-xs bg-[#D4AF37]/10 text-[#D4AF37] px-2 py-0.5 rounded border border-[#D4AF37]/20">
                    {key.plan_tier}
                  </span>
                </div>
                <code className="text-xs text-[#888]">{maskKey(key.key_hash)}</code>
                <span className="text-xs text-[#555]">Created {formatDate(key.created_at)}</span>
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
      {/* Section 2: Sync Preferences (Coming Soon)                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-10">
        <h2 className="text-sm font-bold text-[#888] tracking-widest uppercase mb-4">Sync Preferences</h2>
        <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden">
          {[
            { label: "Auto-sync interval", placeholder: "e.g. 15 minutes" },
            { label: "Quality filter", placeholder: "e.g. Minimum score 0.6" },
            { label: "Namespace routing", placeholder: "e.g. default" },
          ].map((field) => (
            <div key={field.label} className="flex items-center justify-between gap-4 p-4 border-b border-[#222] last:border-b-0 opacity-50">
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-sm text-[#ededed]">{field.label}</label>
                <input
                  disabled
                  placeholder={field.placeholder}
                  className="bg-[#050a0f] border border-[#222] rounded px-3 py-2 text-sm text-[#555] placeholder-[#333] cursor-not-allowed w-full"
                />
              </div>
              <span className="flex-shrink-0 text-xs bg-[#222] text-[#555] px-2 py-1 rounded border border-[#333]">
                Coming soon
              </span>
            </div>
          ))}
        </div>
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
