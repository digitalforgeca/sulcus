"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/providers";
import {
  UserCircle, Shield, Crown, Sparkles, Mail, Hash, Users,
  Plus, Trash2, Building2, Check, X, Pencil, Loader2,
} from "lucide-react";

import { SERVER_URL, authHeaders } from "@/lib/api";

interface OrgMember {
  email: string;
  name: string | null;
  role: string;
  joined_at: string;
}

interface OrgInfo {
  tenant_id: string;
  org_name: string | null;
  plan_tier: string;
  max_seats: number | null;
  seats_used: number;
  features: string;
  members: OrgMember[];
}

const TIER_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode; border: string }> = {
  free: { label: "Open", color: "#00F0FF", icon: <Shield size={14} />, border: "border-[#00F0FF]/50" },
  cortex: { label: "Cortex", color: "#D4AF37", icon: <Sparkles size={14} />, border: "border-[#D4AF37]/50" },
  enterprise: { label: "Enterprise", color: "#8B5CF6", icon: <Crown size={14} />, border: "border-purple-500/50" },
};

function TierBadge({ tier }: { tier: string }) {
  const config = TIER_CONFIG[tier] || TIER_CONFIG.free;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 border rounded-full text-xs uppercase tracking-widest font-bold ${config.border}`}
      style={{ color: config.color }}>
      {config.icon}
      {config.label}
    </span>
  );
}

export default function AccountPage() {
  const { user, logout, loading } = useAuth();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [orgName, setOrgName] = useState("");

  useEffect(() => {
    async function loadOrg() {
      try {
        const hdrs = await authHeaders();
        const res = await fetch(`${SERVER_URL}/api/v1/org`, { headers: hdrs });
        if (res.ok) {
          const data: OrgInfo = await res.json();
          setOrg(data);
          setOrgName(data.org_name || "");
        }
      } catch (err) {
        console.error("Failed to load org", err);
      } finally {
        setOrgLoading(false);
      }
    }
    loadOrg();
  }, []);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError("");
    setInviteSuccess("");
    try {
      const hdrs = await authHeaders();
      const res = await fetch(`${SERVER_URL}/api/v1/org/invite`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteSuccess(`Invited ${inviteEmail}`);
        setInviteEmail("");
        const r2 = await fetch(`${SERVER_URL}/api/v1/org`, { headers: hdrs });
        if (r2.ok) setOrg(await r2.json());
      } else {
        setInviteError(data.message || data.error || "Failed to invite");
      }
    } catch {
      setInviteError("Network error");
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (email: string) => {
    if (!confirm(`Remove ${email} from your organization?`)) return;
    try {
      const hdrs = await authHeaders();
      const res = await fetch(`${SERVER_URL}/api/v1/org/members`, {
        method: "DELETE",
        headers: hdrs,
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        const r2 = await fetch(`${SERVER_URL}/api/v1/org`, { headers: hdrs });
        if (r2.ok) setOrg(await r2.json());
      }
    } catch {
      alert("Failed to remove member");
    }
  };

  const handleSaveOrgName = async () => {
    try {
      const hdrs = await authHeaders();
      await fetch(`${SERVER_URL}/api/v1/org`, {
        method: "PATCH",
        headers: hdrs,
        body: JSON.stringify({ org_name: orgName }),
      });
      setEditingName(false);
      if (org) setOrg({ ...org, org_name: orgName });
    } catch {
      alert("Failed to save");
    }
  };

  if (loading) {
    return <div className="text-[#888] font-mono animate-pulse">Loading...</div>;
  }

  const accountConsoleUrl = `${process.env.NEXT_PUBLIC_KEYCLOAK_URL || "https://sulcus-keycloak.calmstone-a7a24a97.westus.azurecontainerapps.io"}/realms/sulcus/account`;
  const tier = org?.plan_tier || (user?.roles?.find(r => ["enterprise", "cortex", "pro"].includes(r)) || "free");
  const seatsPct = org?.max_seats ? Math.min((org.seats_used / org.max_seats) * 100, 100) : 0;

  return (
    <div className="max-w-3xl font-sans">
      <h1 className="text-3xl font-bold mb-8 tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
        <UserCircle size={24} className="text-[#00F0FF]" />
        Identity & Access
      </h1>

      {/* Profile Card */}
      <div className="bg-[#0a1520] p-8 border border-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.05)] relative mb-8 rounded-sm">
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#D4AF37]"></div>
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#D4AF37]"></div>
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>

        <div className="flex items-start justify-between mb-6">
          <h2 className="text-xl font-bold text-white uppercase tracking-widest">Active Profile</h2>
          <TierBadge tier={tier} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 font-mono text-sm">
          <div className="flex flex-col gap-1">
            <span className="text-[#888] uppercase tracking-wider text-xs flex items-center gap-1.5">
              <Mail size={10} /> Email
            </span>
            <span className="text-[#00F0FF] text-base">{user?.email || "Unknown"}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[#888] uppercase tracking-wider text-xs flex items-center gap-1.5">
              <UserCircle size={10} /> Name
            </span>
            <span className="text-white text-base">{user?.name || "Unknown"}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[#888] uppercase tracking-wider text-xs flex items-center gap-1.5">
              <Hash size={10} /> Subject ID
            </span>
            <span className="text-[#555] text-xs select-all break-all">{user?.id || "Unknown"}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[#888] uppercase tracking-wider text-xs flex items-center gap-1.5">
              <Shield size={10} /> Roles
            </span>
            <div className="flex gap-2 flex-wrap">
              {(user?.roles?.length ? user.roles : ["none"]).map(r => (
                <span key={r} className="text-xs px-2 py-0.5 border border-[#333] rounded-full text-[#888]">{r}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Organization Card */}
      <div className="bg-[#0a1520] p-8 border border-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.05)] relative mb-8 rounded-sm">
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>

        <div className="flex items-start justify-between mb-6">
          <h2 className="text-xl font-bold text-white uppercase tracking-widest flex items-center gap-2">
            <Building2 size={18} className="text-[#D4AF37]" />
            Organization
          </h2>
          {org?.max_seats && (
            <span className="text-xs text-[#888] font-mono">
              {org.seats_used}/{org.max_seats === null ? "∞" : org.max_seats} seats
            </span>
          )}
        </div>

        {orgLoading ? (
          <div className="text-[#555] animate-pulse text-sm font-mono">Loading org…</div>
        ) : (
          <>
            {/* Org Name */}
            <div className="mb-6">
              <span className="text-[#888] uppercase tracking-wider text-xs block mb-2">Organization Name</span>
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input value={orgName} onChange={e => setOrgName(e.target.value)} autoFocus
                    className="bg-[#111820] border border-[#D4AF37]/50 text-white px-3 py-2 text-sm focus:outline-none flex-1 rounded-sm" />
                  <button onClick={handleSaveOrgName} className="text-green-500 p-2 hover:bg-green-500/10 rounded-sm"><Check size={16} /></button>
                  <button onClick={() => setEditingName(false)} className="text-red-500 p-2 hover:bg-red-500/10 rounded-sm"><X size={16} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm">{org?.org_name || "(not set)"}</span>
                  <button onClick={() => { setEditingName(true); setOrgName(org?.org_name || ""); }}
                    className="text-[#555] hover:text-[#D4AF37] p-1"><Pencil size={14} /></button>
                </div>
              )}
            </div>

            {/* Seats bar */}
            {org?.max_seats && (
              <div className="mb-6">
                <div className="flex justify-between mb-2">
                  <span className="text-xs uppercase tracking-wider text-[#888]">Seats</span>
                  <span className="text-xs font-mono text-[#D4AF37]">{org.seats_used} / {org.max_seats}</span>
                </div>
                <div className="w-full bg-black h-1.5 rounded-full">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${seatsPct > 80 ? "bg-[#D4AF37] shadow-[0_0_8px_#D4AF37]" : "bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"}`}
                    style={{ width: `${seatsPct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Members list */}
            <div className="mb-4">
              <span className="text-[#888] uppercase tracking-wider text-xs flex items-center gap-1.5 mb-3">
                <Users size={12} /> Members
              </span>
              {(org?.members?.length ?? 0) === 0 ? (
                <div className="text-[#555] text-sm mb-4">No members yet. Invite your first team member below.</div>
              ) : (
                <div className="space-y-2 mb-4">
                  {org?.members.map(member => (
                    <div key={member.email} className="flex items-center justify-between py-2 px-3 bg-[#111820] border border-[#D4AF37]/10 rounded-sm group">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${member.role === "owner" ? "bg-[#D4AF37]" : "bg-[#00F0FF]"}`} />
                        <div>
                          <span className="text-sm text-white">{member.email}</span>
                          {member.name && <span className="text-xs text-[#555] ml-2">({member.name})</span>}
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 border rounded-full uppercase tracking-widest ${
                          member.role === "owner" ? "border-[#D4AF37]/50 text-[#D4AF37]" : "border-[#333] text-[#888]"
                        }`}>{member.role}</span>
                      </div>
                      {member.role !== "owner" && (
                        <button onClick={() => handleRemove(member.email)}
                          className="text-[#333] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Invite form */}
            <div className="border-t border-[#D4AF37]/10 pt-4">
              <span className="text-[#888] uppercase tracking-wider text-xs block mb-2">Invite Member</span>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
                  <input value={inviteEmail} onChange={e => { setInviteEmail(e.target.value); setInviteError(""); setInviteSuccess(""); }}
                    onKeyDown={e => e.key === "Enter" && handleInvite()}
                    placeholder="team@example.com"
                    className="w-full bg-[#111820] border border-[#D4AF37]/20 text-white text-sm pl-9 pr-3 py-2 focus:outline-none focus:border-[#D4AF37]/50 placeholder-[#333] rounded-sm" />
                </div>
                <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}
                  className="px-4 py-2 bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30 text-xs uppercase tracking-widest hover:bg-[#D4AF37]/30 transition-colors disabled:opacity-50 flex items-center gap-2 rounded-sm">
                  {inviting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Invite
                </button>
              </div>
              {inviteError && <p className="text-red-400 text-xs mt-2">{inviteError}</p>}
              {inviteSuccess && <p className="text-green-400 text-xs mt-2">{inviteSuccess}</p>}
            </div>
          </>
        )}
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#0a1520] p-6 border border-[#D4AF37]/30 flex flex-col justify-between h-full relative group hover:border-[#00F0FF]/50 transition-colors rounded-sm">
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>
          <div>
            <h3 className="text-lg font-bold text-white mb-2 tracking-widest uppercase flex items-center gap-2">
              <Shield size={16} /> Account Console
            </h3>
            <p className="text-sm text-[#888] mb-6">Manage credentials, 2FA, and active sessions.</p>
          </div>
          <a href={accountConsoleUrl} target="_blank" rel="noreferrer"
            className="bg-transparent border border-[#D4AF37] text-[#D4AF37] px-4 py-2 font-bold hover:bg-[#D4AF37] hover:text-[#050a0f] transition-all tracking-widest text-center text-sm rounded-sm">
            MANAGE SECURITY
          </a>
        </div>

        <div className="bg-[#0a1520] p-6 border border-red-900/30 flex flex-col justify-between h-full relative group hover:border-red-500/50 transition-colors rounded-sm">
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-red-500"></div>
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-red-500"></div>
          <div>
            <h3 className="text-lg font-bold text-white mb-2 tracking-widest uppercase flex items-center gap-2">
              <X size={16} className="text-red-500" /> Session Control
            </h3>
            <p className="text-sm text-[#888] mb-6">Terminate your current session and revoke access.</p>
          </div>
          <button onClick={() => logout()}
            className="w-full bg-red-950/30 border border-red-500/50 text-red-400 px-4 py-2 font-bold hover:bg-red-500 hover:text-white transition-all tracking-widest text-center text-sm rounded-sm">
            SIGN OUT
          </button>
        </div>
      </div>
    </div>
  );
}
