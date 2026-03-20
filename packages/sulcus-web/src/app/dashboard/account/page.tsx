"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  Suspense,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/providers";
import {
  TbUserCircle,
  TbLock,
  TbCrown,
  TbSparkles,
  TbMail,
  TbHash,
  TbUsers,
  TbPlus,
  TbTrash,
  TbBuilding,
  TbCheck,
  TbX,
  TbPencil,
  TbLoader2,
  TbKey,
  TbCopy,
  TbFlame,
  TbRefresh,
  TbAlertTriangle,
  TbSettings,
  TbCreditCard,
  TbRobot,
  TbDatabase,
  TbActivity,
  TbClock,
  TbChevronRight,
} from "react-icons/tb";
import { SERVER_URL, authHeaders, apiFetch } from "@/lib/api";
import { useSulcusApi, type ThermoConfig, type DecayProfile } from "@/hooks/useSulcusApi";
import * as d3 from "d3";

// ── Types ────────────────────────────────────────────────────────────────────

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

interface ApiKey {
  id: string;
  label: string;
  prefix: string;
  plan_tier: string;
  created_at: string;
  last_used_at?: string;
}

interface UsageData {
  month: string;
  sync_requests: number;
  nodes_added: number;
  avg_latency_ms: number;
  max_latency_ms: number;
}

interface StripeProduct {
  id: string;
  name: string;
  description: string;
  metadata?: Record<string, string>;
}

interface StripePrice {
  id: string;
  product: string;
  unit_amount: number;
  currency: string;
  recurring?: { interval: string };
}

interface NamespaceCount {
  namespace: string;
  count: number;
}

interface DashboardData {
  total_nodes: number;
  avg_heat: number;
  type_distribution: { memory_type: string; count: number }[];
  namespace_counts: NamespaceCount[];
  recent_nodes: { id: string; label: string; memory_type: string; heat: number; updated_at: string }[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const SULCUS_TIERS = ["cortex", "enterprise"];

const TIER_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode; border: string }> = {
  free: { label: "Open", color: "#00F0FF", icon: <TbLock size={14} />, border: "border-[#00F0FF]/50" },
  cortex: { label: "Cortex", color: "#D4AF37", icon: <TbSparkles size={14} />, border: "border-[#D4AF37]/50" },
  enterprise: { label: "Enterprise", color: "#8B5CF6", icon: <TbCrown size={14} />, border: "border-purple-500/50" },
};

const MEMORY_TYPES = ["episodic", "semantic", "procedural", "preference", "fact"] as const;

const TYPE_LABELS: Record<string, string> = {
  episodic: "Episodic", semantic: "Semantic", procedural: "Procedural",
  preference: "Preference", fact: "Fact",
};

// Spec colors: episodic=#FF6B6B, semantic=#00F0FF, preference=#D4AF37, procedural=#50FA7B, fact=#BD93F9
const TYPE_COLORS: Record<string, string> = {
  episodic: "#FF6B6B", semantic: "#00F0FF", procedural: "#50FA7B",
  preference: "#D4AF37", fact: "#BD93F9",
};

const AGENT_TYPE_COLORS: Record<string, string> = {
  preference: "#D4AF37", semantic: "#00F0FF", procedural: "#50FA7B",
  episodic: "#FF6B6B", fact: "#BD93F9",
};

const LIFETIME_OPTIONS = [
  { label: "1 Week",   multiplier: 1 },
  { label: "1 Month",  multiplier: 4.3 },
  { label: "3 Months", multiplier: 13 },
  { label: "6 Months", multiplier: 26 },
  { label: "1 Year",   multiplier: 52 },
  { label: "Forever",  multiplier: 1000 },
];

const TIER_LIMITS: Record<string, { sync_requests: number; nodes: number }> = {
  free:       { sync_requests: 10_000,    nodes: 1_000 },
  cortex:     { sync_requests: 100_000,   nodes: 10_000 },
  enterprise: { sync_requests: 1_000_000, nodes: 100_000 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: string }) {
  const config = TIER_CONFIG[tier] || TIER_CONFIG.free;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 border rounded-full text-xs uppercase tracking-widest font-bold ${config.border}`}
      style={{ color: config.color }}
    >
      {config.icon} {config.label}
    </span>
  );
}

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function normalizeTier(raw: string): string {
  if (raw === "starter" || raw === "pro") return "free";
  if (raw === "team") return "cortex";
  return raw || "free";
}

// ── D3 Decay Curve ───────────────────────────────────────────────────────────

function DecayCurve({
  decayProfiles,
  lifetimeMultiplier,
}: {
  decayProfiles: Record<string, DecayProfile>;
  lifetimeMultiplier: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const W = svg.clientWidth || 540;
    const H = svg.clientHeight || 200;
    const margin = { top: 12, right: 20, bottom: 36, left: 38 };
    const width = W - margin.left - margin.right;
    const height = H - margin.top - margin.bottom;

    // Compute max half-life across types (with multiplier applied)
    const profiles = MEMORY_TYPES.map((t) => decayProfiles[t]).filter(Boolean);
    const maxHalfLife = Math.max(...profiles.map((p) => p.half_life_secs * lifetimeMultiplier));
    const maxDays = Math.max(7, maxHalfLife / 86400 * 2);

    const xScale = d3.scaleLinear().domain([0, maxDays]).range([0, width]);
    const yScale = d3.scaleLinear().domain([0, 1]).range([height, 0]);

    // Clear previous render
    d3.select(svg).selectAll("*").remove();

    const g = d3.select(svg)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Grid lines
    g.append("g")
      .attr("class", "grid")
      .call(
        d3.axisLeft(yScale)
          .tickSize(-width)
          .tickValues([0.25, 0.5, 0.75])
          .tickFormat(() => "")
      )
      .call((axis) => {
        axis.select(".domain").remove();
        axis.selectAll("line")
          .attr("stroke", "rgba(255,255,255,0.04)")
          .attr("stroke-dasharray", "4 4");
      });

    // X axis
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(
        d3.axisBottom(xScale)
          .ticks(6)
          .tickFormat((v) => {
            const n = v as number;
            if (n === 0) return "0";
            if (n < 1) return `${Math.round(n * 24)}h`;
            if (n >= 365) return `${Math.round(n / 365)}y`;
            if (n >= 30) return `${Math.round(n / 30)}mo`;
            return `${Math.round(n)}d`;
          })
      )
      .call((axis) => {
        axis.select(".domain").attr("stroke", "rgba(255,255,255,0.15)");
        axis.selectAll("text").attr("fill", "#555").attr("font-size", "9").attr("font-family", "monospace");
        axis.selectAll("line").attr("stroke", "rgba(255,255,255,0.1)");
      });

    // Y axis
    g.append("g")
      .call(
        d3.axisLeft(yScale)
          .ticks(4)
          .tickFormat((v) => `${Math.round((v as number) * 100)}%`)
      )
      .call((axis) => {
        axis.select(".domain").attr("stroke", "rgba(255,255,255,0.15)");
        axis.selectAll("text").attr("fill", "#555").attr("font-size", "9").attr("font-family", "monospace");
        axis.selectAll("line").attr("stroke", "rgba(255,255,255,0.1)");
      });

    // Decay curves
    const steps = 200;
    MEMORY_TYPES.forEach((type) => {
      const profile = decayProfiles[type];
      if (!profile) return;

      const halfLifeDays = (profile.half_life_secs * lifetimeMultiplier) / 86400;
      const floor = profile.floor ?? 0;
      const color = TYPE_COLORS[type] || "#888";

      const points: [number, number][] = Array.from({ length: steps + 1 }, (_, i) => {
        const t = (i / steps) * maxDays;
        const heat = Math.max(floor, Math.exp((-Math.LN2 * t) / halfLifeDays));
        return [xScale(t), yScale(heat)];
      });

      const lineGen = d3.line<[number, number]>()
        .x((d) => d[0])
        .y((d) => d[1])
        .curve(d3.curveCatmullRom);

      g.append("path")
        .datum(points)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.85)
        .attr("d", lineGen);

      // Floor line (dotted)
      if (floor > 0) {
        g.append("line")
          .attr("x1", 0).attr("x2", width)
          .attr("y1", yScale(floor)).attr("y2", yScale(floor))
          .attr("stroke", color)
          .attr("stroke-width", 0.5)
          .attr("stroke-dasharray", "3 5")
          .attr("stroke-opacity", 0.4);
      }
    });

    // Legend
    const legend = g.append("g").attr("transform", `translate(${width - 120}, 0)`);
    MEMORY_TYPES.forEach((type, i) => {
      const color = TYPE_COLORS[type] || "#888";
      const row = legend.append("g").attr("transform", `translate(0, ${i * 16})`);
      row.append("line").attr("x1", 0).attr("x2", 12).attr("y1", 5).attr("y2", 5)
        .attr("stroke", color).attr("stroke-width", 1.5);
      row.append("text").attr("x", 16).attr("y", 9)
        .attr("fill", "#888").attr("font-size", "9").attr("font-family", "monospace")
        .text(TYPE_LABELS[type] || type);
    });

  }, [decayProfiles, lifetimeMultiplier]);

  return (
    <svg
      ref={svgRef}
      className="w-full"
      style={{ height: 220 }}
    />
  );
}

// ── Decay Profile Row ─────────────────────────────────────────────────────────

function DecayProfileRow({
  type, profile, onChange,
}: {
  type: string;
  profile: DecayProfile;
  onChange: (updated: DecayProfile) => void;
}) {
  const color = TYPE_COLORS[type] || "#888";
  const [hlInput, setHlInput] = useState(secsToHumanLabel(profile.half_life_secs));
  useEffect(() => { setHlInput(secsToHumanLabel(profile.half_life_secs)); }, [profile.half_life_secs]);

  const commitHalfLife = useCallback(() => {
    const secs = humanLabelToSecs(hlInput);
    if (secs && secs !== profile.half_life_secs) onChange({ ...profile, half_life_secs: secs });
    else setHlInput(secsToHumanLabel(profile.half_life_secs));
  }, [hlInput, profile, onChange]);

  return (
    <div className="flex items-center gap-3 p-3 border-b border-[#222] last:border-b-0">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
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
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-[#888] uppercase tracking-wide">Floor</label>
        <input type="range" min={0} max={0.3} step={0.01} value={profile.floor}
          onChange={(e) => onChange({ ...profile, floor: parseFloat(e.target.value) })}
          className="w-16 accent-[#D4AF37]" />
        <span className="text-[10px] text-[#888] font-mono w-8">{profile.floor.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-[#888] uppercase tracking-wide">Stab+</label>
        <input type="range" min={1} max={3} step={0.1} value={profile.stability_gain}
          onChange={(e) => onChange({ ...profile, stability_gain: parseFloat(e.target.value) })}
          className="w-16 accent-[#D4AF37]" />
        <span className="text-[10px] text-[#888] font-mono w-8">{profile.stability_gain.toFixed(1)}</span>
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title, subtitle, accent = "gold", children,
}: {
  title: React.ReactNode;
  subtitle?: string;
  accent?: "gold" | "cyan";
  children: React.ReactNode;
}) {
  const borderColor = accent === "cyan" ? "#00F0FF" : "#D4AF37";
  const borderClass = accent === "cyan" ? "border-[#00F0FF]/20" : "border-[#D4AF37]/30";
  return (
    <div className={`bg-[#0a1520] p-8 border ${borderClass} shadow-[0_0_15px_rgba(212,175,55,0.03)] relative mb-8 rounded-sm`}>
      <div className="absolute top-0 left-0 w-2 h-2 border-t border-l" style={{ borderColor }} />
      <div className="absolute top-0 right-0 w-2 h-2 border-t border-r" style={{ borderColor }} />
      <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l" style={{ borderColor }} />
      <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r" style={{ borderColor }} />
      <div className="mb-6">{title}</div>
      {subtitle && <p className="text-[#888] text-xs mb-6">{subtitle}</p>}
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: PROFILE
// ═══════════════════════════════════════════════════════════════════════════

function ProfileTab() {
  const { user, logout } = useAuth();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [orgName, setOrgName] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const hdrs = await authHeaders();
        const res = await fetch(`${SERVER_URL}/api/v1/org`, { headers: hdrs });
        if (res.ok) {
          const data: OrgInfo = await res.json();
          data.plan_tier = normalizeTier(data.plan_tier);
          setOrg(data);
          setOrgName(data.org_name || "");
        }
      } catch (err) {
        console.error("Failed to load org", err);
      } finally {
        setOrgLoading(false);
      }
    })();
  }, []);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true); setInviteError(""); setInviteSuccess("");
    try {
      const hdrs = await authHeaders();
      const res = await fetch(`${SERVER_URL}/api/v1/org/invite`, {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteSuccess(`Invited ${inviteEmail}`); setInviteEmail("");
        const r2 = await fetch(`${SERVER_URL}/api/v1/org`, { headers: hdrs });
        if (r2.ok) setOrg(await r2.json());
      } else {
        setInviteError(data.message || data.error || "Failed to invite");
      }
    } catch { setInviteError("Network error"); }
    finally { setInviting(false); }
  };

  const handleRemove = async (email: string) => {
    if (!confirm(`Remove ${email} from your organization?`)) return;
    try {
      const hdrs = await authHeaders();
      const res = await fetch(`${SERVER_URL}/api/v1/org/members`, {
        method: "DELETE", headers: hdrs, body: JSON.stringify({ email }),
      });
      if (res.ok) {
        const r2 = await fetch(`${SERVER_URL}/api/v1/org`, { headers: hdrs });
        if (r2.ok) setOrg(await r2.json());
      }
    } catch { alert("Failed to remove member"); }
  };

  const handleSaveOrgName = async () => {
    try {
      const hdrs = await authHeaders();
      await fetch(`${SERVER_URL}/api/v1/org`, {
        method: "PATCH", headers: hdrs, body: JSON.stringify({ org_name: orgName }),
      });
      setEditingName(false);
      if (org) setOrg({ ...org, org_name: orgName });
    } catch { alert("Failed to save"); }
  };

  const tier = normalizeTier(
    org?.plan_tier || user?.roles?.find((r) => ["enterprise", "cortex"].includes(r)) || "free"
  );
  const seatsPct = org?.max_seats ? Math.min((org.seats_used / org.max_seats) * 100, 100) : 0;
  const accountConsoleUrl = `${process.env.NEXT_PUBLIC_KEYCLOAK_URL || "https://sulcus-keycloak.calmstone-a7a24a97.westus.azurecontainerapps.io"}/realms/sulcus/account`;

  return (
    <div className="max-w-3xl">
      {/* Profile Card */}
      <Section
        title={
          <div className="flex items-start justify-between">
            <h2 className="text-xl font-bold text-white uppercase tracking-widest">Active Profile</h2>
            <TierBadge tier={tier} />
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 font-mono text-sm">
          <div className="flex flex-col gap-1">
            <span className="text-[#888] uppercase tracking-wider text-xs flex items-center gap-1.5"><TbMail size={10} /> Email</span>
            <span className="text-[#00F0FF] text-base">{user?.email || "Unknown"}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[#888] uppercase tracking-wider text-xs flex items-center gap-1.5"><TbUserCircle size={10} /> Name</span>
            <span className="text-white text-base">{user?.name || "Unknown"}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[#888] uppercase tracking-wider text-xs flex items-center gap-1.5"><TbHash size={10} /> Subject ID</span>
            <span className="text-[#555] text-xs select-all break-all">{user?.id || "Unknown"}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[#888] uppercase tracking-wider text-xs flex items-center gap-1.5"><TbLock size={10} /> Roles</span>
            <div className="flex gap-2 flex-wrap">
              {(user?.roles?.length ? user.roles : ["none"]).map((r) => (
                <span key={r} className="text-xs px-2 py-0.5 border border-[#333] rounded-full text-[#888]">{r}</span>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* Organization Card */}
      <Section title={
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-bold text-white uppercase tracking-widest flex items-center gap-2">
            <TbBuilding size={18} className="text-[#D4AF37]" /> Organization
          </h2>
          {org?.max_seats && (
            <span className="text-xs text-[#888] font-mono">{org.seats_used}/{org.max_seats === null ? "∞" : org.max_seats} seats</span>
          )}
        </div>
      }>
        {orgLoading ? (
          <div className="text-[#555] animate-pulse text-sm font-mono">Loading org…</div>
        ) : (
          <>
            <div className="mb-6">
              <span className="text-[#888] uppercase tracking-wider text-xs block mb-2">Organization Name</span>
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input value={orgName} onChange={(e) => setOrgName(e.target.value)} autoFocus
                    className="bg-[#111820] border border-[#D4AF37]/50 text-white px-3 py-2 text-sm focus:outline-none flex-1 rounded-sm" />
                  <button onClick={handleSaveOrgName} className="text-green-500 p-2 hover:bg-green-500/10 rounded-sm"><TbCheck size={16} /></button>
                  <button onClick={() => setEditingName(false)} className="text-red-500 p-2 hover:bg-red-500/10 rounded-sm"><TbX size={16} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm">{org?.org_name || "(not set)"}</span>
                  <button onClick={() => { setEditingName(true); setOrgName(org?.org_name || ""); }}
                    className="text-[#555] hover:text-[#D4AF37] p-1"><TbPencil size={14} /></button>
                </div>
              )}
            </div>

            {org?.max_seats && (
              <div className="mb-6">
                <div className="flex justify-between mb-2">
                  <span className="text-xs uppercase tracking-wider text-[#888]">Seats</span>
                  <span className="text-xs font-mono text-[#D4AF37]">{org.seats_used} / {org.max_seats}</span>
                </div>
                <div className="w-full bg-black h-1.5 rounded-full">
                  <div className={`h-1.5 rounded-full transition-all duration-500 ${seatsPct > 80 ? "bg-[#D4AF37] shadow-[0_0_8px_#D4AF37]" : "bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"}`}
                    style={{ width: `${seatsPct}%` }} />
                </div>
              </div>
            )}

            <div className="mb-4">
              <span className="text-[#888] uppercase tracking-wider text-xs flex items-center gap-1.5 mb-3"><TbUsers size={12} /> Members</span>
              {(org?.members?.length ?? 0) === 0 ? (
                <div className="text-[#555] text-sm mb-4">No members yet.</div>
              ) : (
                <div className="space-y-2 mb-4">
                  {org?.members.map((member) => (
                    <div key={member.email}
                      className="flex items-center justify-between py-2 px-3 bg-[#111820] border border-[#D4AF37]/10 rounded-sm group">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${member.role === "owner" ? "bg-[#D4AF37]" : "bg-[#00F0FF]"}`} />
                        <span className="text-sm text-white">{member.email}</span>
                        {member.name && <span className="text-xs text-[#555]">({member.name})</span>}
                        <span className={`text-[10px] px-2 py-0.5 border rounded-full uppercase tracking-widest ${member.role === "owner" ? "border-[#D4AF37]/50 text-[#D4AF37]" : "border-[#333] text-[#888]"}`}>
                          {member.role}
                        </span>
                      </div>
                      {member.role !== "owner" && (
                        <button onClick={() => handleRemove(member.email)}
                          className="text-[#333] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1">
                          <TbTrash size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-[#D4AF37]/10 pt-4">
                <span className="text-[#888] uppercase tracking-wider text-xs block mb-2">Invite Member</span>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <TbMail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
                    <input value={inviteEmail} onChange={(e) => { setInviteEmail(e.target.value); setInviteError(""); setInviteSuccess(""); }}
                      onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                      placeholder="team@example.com"
                      className="w-full bg-[#111820] border border-[#D4AF37]/20 text-white text-sm pl-9 pr-3 py-2 focus:outline-none focus:border-[#D4AF37]/50 placeholder-[#333] rounded-sm" />
                  </div>
                  <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}
                    className="px-4 py-2 bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30 text-xs uppercase tracking-widest hover:bg-[#D4AF37]/30 transition-colors disabled:opacity-50 flex items-center gap-2 rounded-sm">
                    {inviting ? <TbLoader2 size={14} className="animate-spin" /> : <TbPlus size={14} />}
                    Invite
                  </button>
                </div>
                {inviteError && <p className="text-red-400 text-xs mt-2">{inviteError}</p>}
                {inviteSuccess && <p className="text-green-400 text-xs mt-2">{inviteSuccess}</p>}
              </div>
            </div>
          </>
        )}
      </Section>

      {/* Action cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#0a1520] p-6 border border-[#D4AF37]/30 flex flex-col justify-between h-full relative group hover:border-[#00F0FF]/50 transition-colors rounded-sm">
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]" />
          <div>
            <h3 className="text-lg font-bold text-white mb-2 tracking-widest uppercase flex items-center gap-2">
              <TbLock size={16} /> Account Console
            </h3>
            <p className="text-sm text-[#888] mb-6">Manage credentials, 2FA, and active sessions.</p>
          </div>
          <a href={accountConsoleUrl} target="_blank" rel="noreferrer"
            className="bg-transparent border border-[#D4AF37] text-[#D4AF37] px-4 py-2 font-bold hover:bg-[#D4AF37] hover:text-[#050a0f] transition-all tracking-widest text-center text-sm rounded-sm">
            MANAGE SECURITY
          </a>
        </div>

        <div className="bg-[#0a1520] p-6 border border-red-900/30 flex flex-col justify-between h-full relative group hover:border-red-500/50 transition-colors rounded-sm">
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-red-500" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-red-500" />
          <div>
            <h3 className="text-lg font-bold text-white mb-2 tracking-widest uppercase flex items-center gap-2">
              <TbX size={16} className="text-red-500" /> Session Control
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

// ═══════════════════════════════════════════════════════════════════════════
// TAB: BILLING
// ═══════════════════════════════════════════════════════════════════════════

function BillingTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "canceled">("idle");
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [products, setProducts] = useState<StripeProduct[]>([]);
  const [prices, setPrices] = useState<StripePrice[]>([]);
  const [fetchingProducts, setFetchingProducts] = useState(true);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [loadingTier, setLoadingTier] = useState(true);
  const [currentTier, setCurrentTier] = useState<string | null>(null);
  const [serverLimits, setServerLimits] = useState<{ ops_limit?: number; nodes_limit?: number } | null>(null);

  useEffect(() => {
    if (searchParams.get("success")) setStatus("success");
    if (searchParams.get("canceled")) setStatus("canceled");

    (async () => {
      try {
        const data = await apiFetch<{ plan_tier?: string; ops_limit?: number; nodes_limit?: number }>("/api/v1/org");
        if (data.ops_limit != null || data.nodes_limit != null) {
          setServerLimits({ ops_limit: data.ops_limit, nodes_limit: data.nodes_limit });
        }
        setCurrentTier(normalizeTier(data.plan_tier || "free"));
      } catch { setCurrentTier("free"); }
      finally { setLoadingTier(false); }
    })();

    (async () => {
      try {
        const hdrs = await authHeaders();
        const res = await fetch(`${SERVER_URL}/api/v1/admin/usage`, { headers: hdrs });
        if (res.ok) { const d: UsageData[] = await res.json(); if (d.length > 0) setUsage(d[0]); }
      } catch (err) { console.error(err); }
      finally { setLoadingUsage(false); }
    })();

    (async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/v1/billing/products`);
        if (res.ok) {
          const data = await res.json();
          const allP: StripeProduct[] = data.products?.data || [];
          const allPr: StripePrice[] = data.prices?.data || [];
          setProducts(allP.filter((p) => p.metadata?.tier && SULCUS_TIERS.includes(p.metadata.tier)));
          setPrices(allPr);
        }
      } catch (err) { console.error(err); }
      finally { setFetchingProducts(false); }
    })();
  }, [searchParams]);

  const handleUpgrade = (priceId: string, planName: string, amount?: string) => {
    const params = new URLSearchParams({ price: priceId, plan: planName });
    if (amount) params.set("amount", amount);
    router.push(`/dashboard/billing/checkout?${params.toString()}`);
  };

  const handleManage = async () => {
    setLoading(true);
    try {
      const hdrs = await authHeaders();
      const res = await fetch(`${SERVER_URL}/api/v1/billing/create-portal-session`, { method: "POST", headers: hdrs });
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch { alert("You may not have an active subscription yet."); setLoading(false); }
  };

  const resolvedTier = currentTier ?? "free";
  const tierDefaults = TIER_LIMITS[resolvedTier] ?? TIER_LIMITS.free;
  const limits = { sync_requests: serverLimits?.ops_limit ?? tierDefaults.sync_requests, nodes: serverLimits?.nodes_limit ?? tierDefaults.nodes };
  const syncPct = usage ? Math.min((usage.sync_requests / limits.sync_requests) * 100, 100) : 0;
  const nodesPct = usage ? Math.min((usage.nodes_added / limits.nodes) * 100, 100) : 0;

  const sortedProducts = [...products].sort((a, b) => {
    const order = ["cortex", "enterprise"];
    return order.indexOf(a.metadata?.tier || "") - order.indexOf(b.metadata?.tier || "");
  });

  return (
    <div className="max-w-4xl">
      {status === "success" && (
        <div className="bg-[#0a1520] border border-[#00F0FF]/50 text-[#00F0FF] p-4 font-mono tracking-wider flex justify-between items-center mb-8">
          <span>Upgrade successful! Your tier is being provisioned.</span>
          <button onClick={() => setStatus("idle")}>&times;</button>
        </div>
      )}
      {status === "canceled" && (
        <div className="bg-red-950/30 border border-red-500/50 text-red-400 p-4 font-mono tracking-wider flex justify-between items-center mb-8">
          <span>Checkout canceled. No changes were made.</span>
          <button onClick={() => setStatus("idle")}>&times;</button>
        </div>
      )}

      {/* Current Plan */}
      <Section title={
        <h2 className="text-xl font-bold text-white uppercase tracking-widest">
          Current Plan:{" "}
          {loadingTier || currentTier === null
            ? <span className="animate-pulse text-[#555]">Loading…</span>
            : currentTier === "free" ? "Open (Free)"
            : currentTier === "cortex" ? "✨ Cortex"
            : "👑 Enterprise"}
        </h2>
      }>
        <p className="text-[#888] mb-6 text-sm">
          {!loadingTier && currentTier === "free" && "Local sidecar with cloud sync. Upgrade for team features and higher limits."}
          {!loadingTier && currentTier === "cortex" && "Team plan with 100K sync/mo, 10K nodes, remote MCP, and priority support."}
          {!loadingTier && currentTier === "enterprise" && "Unlimited everything. Dedicated support and custom retention."}
        </p>
        {loadingUsage ? (
          <div className="text-[#888] animate-pulse font-mono text-sm">Loading usage…</div>
        ) : usage ? (
          <div className="space-y-4 max-w-lg">
            {[
              { label: "Sync Requests (this month)", value: usage.sync_requests, limit: limits.sync_requests, pct: syncPct },
              { label: "Nodes Added (this month)", value: usage.nodes_added, limit: limits.nodes, pct: nodesPct },
            ].map(({ label, value, limit, pct }) => (
              <div key={label} className="bg-[#111820] p-4 border border-[#D4AF37]/20">
                <div className="flex justify-between mb-2">
                  <span className="text-xs uppercase tracking-wider text-[#888]">{label}</span>
                  <span className="text-xs font-bold text-[#D4AF37]">{value.toLocaleString()} / {limit.toLocaleString()}</span>
                </div>
                <div className="w-full bg-black h-1">
                  <div className={`h-1 transition-all duration-500 ${pct > 80 ? "bg-[#D4AF37] shadow-[0_0_8px_#D4AF37]" : "bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"}`}
                    style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
            <div className="flex gap-4">
              {[{ label: "Avg Latency", val: `${usage.avg_latency_ms.toFixed(1)}ms` }, { label: "Peak Latency", val: `${usage.max_latency_ms.toFixed(1)}ms` }].map(({ label, val }) => (
                <div key={label} className="bg-[#111820] p-3 border border-[#D4AF37]/10 flex-1">
                  <div className="text-xs uppercase tracking-wider text-[#888] mb-1">{label}</div>
                  <div className="text-lg font-mono text-[#00F0FF]">{val}</div>
                </div>
              ))}
            </div>
          </div>
        ) : <div className="text-[#555] font-mono text-sm">No usage data yet.</div>}
      </Section>

      {/* Plans */}
      <h2 className="text-2xl font-bold mb-6 tracking-widest text-white uppercase">Plans</h2>
      {fetchingProducts ? (
        <div className="text-[#888] animate-pulse font-mono text-sm uppercase">Loading plans from Stripe…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {/* Free tier */}
          <div className={`bg-[#0a1520] p-6 border relative flex flex-col ${currentTier === "free" ? "border-[#00F0FF]/30" : "border-[#333]"}`}>
            <div className={`absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent ${currentTier === "free" ? "via-[#00F0FF]" : "via-[#333]"} to-transparent`} />
            {currentTier === "free" && <div className="text-xs uppercase tracking-widest text-[#00F0FF] mb-2">Current</div>}
            <h3 className="text-lg font-bold text-white tracking-widest uppercase mb-1">Open</h3>
            <div className="text-2xl font-mono text-white mb-3">Free</div>
            <ul className="text-[#888] text-sm space-y-2 flex-1 mb-4">
              {["Local embedded PG", "Cloud sync (10K req/mo)", "1 agent", "MCP tools"].map((f) => (
                <li key={f} className="flex items-start gap-2"><span className="text-[#00F0FF]">✓</span> {f}</li>
              ))}
            </ul>
            <div className={`w-full border px-4 py-2 text-center text-sm tracking-widest uppercase ${currentTier === "free" ? "border-[#00F0FF]/30 text-[#00F0FF]" : "border-[#333] text-[#555]"}`}>
              {currentTier === "free" ? "Active" : "Free Tier"}
            </div>
          </div>

          {sortedProducts.map((product) => {
            const price = prices.find((p) => p.product === product.id);
            const priceStr = price ? `$${(price.unit_amount / 100).toFixed(0)}` : "Custom";
            const interval = price?.recurring?.interval ? `/${price.recurring.interval}` : "";
            const isCortex = product.metadata?.tier === "cortex";
            const meta = product.metadata || {};
            const isActive = meta.tier === currentTier;

            const featureItems: string[] = [];
            if (meta.max_sync_requests) featureItems.push(meta.max_sync_requests === "unlimited" ? "Unlimited sync" : `${Number(meta.max_sync_requests).toLocaleString()} sync/mo`);
            if (meta.max_agents) featureItems.push(meta.max_agents === "unlimited" ? "Unlimited agents" : `${meta.max_agents} agents`);
            if (meta.max_nodes) featureItems.push(meta.max_nodes === "unlimited" ? "Unlimited nodes" : `${Number(meta.max_nodes).toLocaleString()} nodes`);
            if (meta.features) meta.features.split(",").forEach((f: string) => featureItems.push(f.trim().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())));

            return (
              <div key={product.id} className={`bg-[#0a1520] p-6 border relative flex flex-col ${isActive ? "border-[#00F0FF]/50" : isCortex ? "border-[#D4AF37]/40" : "border-[#333]"}`}>
                <div className={`absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent ${isActive ? "via-[#00F0FF]" : isCortex ? "via-[#D4AF37]" : "via-[#555]"} to-transparent`} />
                <div className={`text-xs uppercase tracking-widest mb-2 ${isActive ? "text-[#00F0FF]" : isCortex ? "text-[#D4AF37]" : "text-[#555]"}`}>
                  {isActive ? "Current Plan" : isCortex ? "Recommended" : "Teams"}
                </div>
                <h3 className={`text-lg font-bold tracking-widest uppercase mb-1 ${isCortex ? "text-[#D4AF37]" : "text-white"}`}>
                  {product.name.replace("Sulcus ", "")}
                </h3>
                <div className="text-2xl font-mono text-white mb-3">{priceStr}<span className="text-sm text-[#888]">{interval}</span></div>
                <ul className="text-[#888] text-sm space-y-2 flex-1 mb-4">
                  {featureItems.map((feat, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={isCortex ? "text-[#D4AF37]" : "text-[#555]"}>✓</span> {feat}
                    </li>
                  ))}
                </ul>
                {isActive ? (
                  <div className="w-full border border-[#00F0FF]/30 text-[#00F0FF] px-4 py-2 text-center text-sm tracking-widest uppercase">Active</div>
                ) : price ? (
                  <button onClick={() => handleUpgrade(price.id, product.name, priceStr)} disabled={loading}
                    className={`w-full px-4 py-2 text-sm font-bold tracking-widest uppercase transition-all disabled:opacity-50 ${isCortex ? "bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-[#050a0f] hover:brightness-110" : "border border-[#555] text-[#888] hover:border-[#D4AF37] hover:text-[#D4AF37]"}`}>
                    {loading ? "Processing…" : "Subscribe"}
                  </button>
                ) : (
                  <div className="w-full border border-[#333] text-[#555] px-4 py-2 text-center text-sm tracking-widest uppercase">Contact Us</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Manage Subscription */}
      <div className="bg-[#0a1520] p-6 border border-[#00F0FF]/20 relative">
        <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#00F0FF] to-transparent" />
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-1">Manage Subscription</h3>
            <p className="text-xs text-[#555]">Update billing, download invoices, or cancel via the Stripe portal.</p>
          </div>
          <button onClick={handleManage} disabled={loading}
            className="text-xs text-[#00F0FF] border border-[#00F0FF]/30 px-4 py-2 hover:bg-[#00F0FF]/10 transition-colors uppercase tracking-widest disabled:opacity-50">
            {loading ? "Processing…" : "Customer Portal"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS SUB-TAB: API KEYS
// ═══════════════════════════════════════════════════════════════════════════

function ApiSubTab() {
  const { apiKeys, createKey, revokeKey, usage } = useSulcusApi();
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = () => {
    if (!newLabel.trim()) return;
    createKey.mutate(newLabel.trim(), {
      onSuccess: (result) => {
        setShowCreate(false);
        setNewLabel("");
        setNewKeyValue(result.key);
      },
    });
  };

  const handleRevoke = (id: string) => {
    revokeKey.mutate(id, { onSuccess: () => setRevokeTarget(null) });
  };

  const usageData = usage.data?.[0];

  return (
    <div className="space-y-8">
      {/* API Keys */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-[#888] tracking-widest uppercase flex items-center gap-2">
            <TbKey size={14} className="text-[#00F0FF]" /> API Keys
          </h3>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded text-[#D4AF37] text-xs hover:bg-[#D4AF37]/20 transition-colors">
            <TbPlus size={14} /> Create Key
          </button>
        </div>

        <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden">
          {apiKeys.isLoading && (
            [0, 1].map((i) => (
              <div key={i} className="flex items-center gap-4 p-4 border-b border-[#222] animate-pulse last:border-b-0">
                <div className="h-3 flex-1 bg-[#050a0f] rounded" /><div className="h-3 w-24 bg-[#050a0f] rounded" />
              </div>
            ))
          )}
          {!apiKeys.isLoading && (!apiKeys.data || apiKeys.data.length === 0) && (
            <div className="p-8 text-center text-[#888] text-sm">No API keys yet. Create one to authenticate with the Sulcus API.</div>
          )}
          {apiKeys.data?.map((key) => (
            <div key={key.id} className="flex items-center justify-between gap-4 p-4 border-b border-[#222] last:border-b-0">
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm truncate">{key.label || "API Key"}</span>
                  <span className="text-xs bg-[#D4AF37]/10 text-[#D4AF37] px-2 py-0.5 rounded border border-[#D4AF37]/20">{key.plan_tier}</span>
                </div>
                <code className="text-xs text-[#888]">{key.prefix ? `${key.prefix}••••••••` : `${key.id.slice(0, 8)}••••••••`}</code>
                <span className="text-xs text-[#555]">Created {formatDate(key.created_at)}{key.last_used_at ? ` · Last used ${formatDate(key.last_used_at)}` : ""}</span>
              </div>
              <button onClick={() => setRevokeTarget(key.id)}
                className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 border border-red-500/20 rounded text-red-400 text-xs hover:bg-red-500/10 transition-colors">
                <TbTrash size={12} /> Revoke
              </button>
            </div>
          ))}
        </div>

        {/* Create form inline */}
        {showCreate && (
          <div className="mt-4 flex gap-3">
            <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Key label — e.g. Claude Desktop"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="flex-1 bg-[#050a0f] border border-[#1a2a3a] px-3 py-2 text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#00F0FF]/50 rounded-sm font-mono"
              autoFocus />
            <button onClick={handleCreate} disabled={createKey.isPending || !newLabel.trim()}
              className="px-4 py-2 bg-[#00F0FF]/10 text-[#00F0FF] border border-[#00F0FF]/30 text-xs uppercase tracking-widest hover:bg-[#00F0FF]/20 transition-colors disabled:opacity-50 flex items-center gap-2 rounded-sm">
              {createKey.isPending ? <TbLoader2 size={14} className="animate-spin" /> : <TbPlus size={14} />}
              Generate
            </button>
            <button onClick={() => { setShowCreate(false); setNewLabel(""); }}
              className="px-3 py-2 text-[#555] hover:text-white transition-colors text-xs"><TbX size={14} /></button>
          </div>
        )}
      </div>

      {/* New key reveal */}
      {newKeyValue && (
        <div className="p-4 bg-[#0d2b1a] border border-green-500/40 rounded-sm">
          <p className="text-green-400 text-xs uppercase tracking-widest mb-2">Key created — copy now, won&apos;t be shown again</p>
          <div className="flex items-center gap-3">
            <code className="flex-1 font-mono text-xs text-green-300 break-all">{newKeyValue}</code>
            <button onClick={() => { navigator.clipboard.writeText(newKeyValue!); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="shrink-0 text-green-400 hover:text-white transition-colors">
              {copied ? <TbCheck size={16} /> : <TbCopy size={16} />}
            </button>
          </div>
          <button onClick={() => setNewKeyValue(null)} className="mt-3 text-xs text-[#888] hover:text-white transition-colors">Dismiss</button>
        </div>
      )}

      {/* Usage Stats */}
      {usageData && (
        <div>
          <h3 className="text-sm font-bold text-[#888] tracking-widest uppercase mb-4 flex items-center gap-2">
            <TbActivity size={14} className="text-[#D4AF37]" /> Usage This Month
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Sync Requests", val: usageData.sync_requests.toLocaleString() },
              { label: "Nodes Added", val: usageData.nodes_added.toLocaleString() },
              { label: "Avg Latency", val: `${usageData.avg_latency_ms.toFixed(1)}ms` },
              { label: "Peak Latency", val: `${usageData.max_latency_ms.toFixed(1)}ms` },
            ].map(({ label, val }) => (
              <div key={label} className="bg-[#0a1520] p-4 border border-[#D4AF37]/10 rounded-sm">
                <div className="text-xs text-[#888] uppercase tracking-widest mb-1">{label}</div>
                <div className="text-xl font-mono text-[#00F0FF]">{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Revoke confirm */}
      {revokeTarget && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-[#0a1520] border border-[#222] rounded-lg p-6 w-full max-w-md font-mono">
            <div className="flex items-center gap-2 mb-2">
              <TbAlertTriangle size={20} className="text-red-400" />
              <h3 className="font-bold text-lg">Revoke API Key</h3>
            </div>
            <p className="text-[#888] text-sm mb-6">Any services using this key will lose access immediately.</p>
            <div className="flex gap-3">
              <button onClick={() => setRevokeTarget(null)} className="flex-1 py-2 border border-[#222] rounded text-[#888] text-sm hover:text-[#ededed] transition-colors">Cancel</button>
              <button onClick={() => handleRevoke(revokeTarget)} className="flex-1 py-2 rounded text-sm bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors">Revoke</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS SUB-TAB: AGENTS (Memory Lifetime + D3 Decay Curve)
// ═══════════════════════════════════════════════════════════════════════════

function AgentsSubTab() {
  const [agents, setAgents] = useState<NamespaceCount[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [selectedNs, setSelectedNs] = useState<string | null>(null);
  const { thermoConfig, updateThermoConfig } = useSulcusApi();
  const [lifetimeIdx, setLifetimeIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await apiFetch<DashboardData>("/api/v1/admin/dashboard");
        setAgents(d.namespace_counts || []);
        if (d.namespace_counts?.length > 0) setSelectedNs(d.namespace_counts[0].namespace);
      } catch (err) { console.error(err); }
      finally { setAgentsLoading(false); }
    })();
  }, []);

  const decayProfiles = thermoConfig.data?.config?.decay_profiles;
  const defaultProfiles = thermoConfig.data?.defaults?.decay_profiles;

  // Compute effective profiles with lifetime multiplier applied to defaults
  const effectiveProfiles = decayProfiles && defaultProfiles
    ? Object.fromEntries(
        Object.entries(decayProfiles).map(([type, profile]) => {
          const defaultHl = defaultProfiles[type]?.half_life_secs ?? profile.half_life_secs;
          return [type, { ...profile, half_life_secs: defaultHl * LIFETIME_OPTIONS[lifetimeIdx].multiplier }];
        })
      )
    : decayProfiles;

  const handleApplyLifetime = async () => {
    if (!effectiveProfiles || !thermoConfig.data?.config) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateThermoConfig.mutateAsync({
        ...thermoConfig.data.config,
        decay_profiles: effectiveProfiles as Record<string, DecayProfile>,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  return (
    <div className="flex gap-6">
      {/* Agent sidebar */}
      <div className="w-48 shrink-0">
        <h3 className="text-xs font-bold text-[#888] uppercase tracking-widest mb-3 flex items-center gap-1.5">
          <TbRobot size={12} /> Agent Fleet
        </h3>
        {agentsLoading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => <div key={i} className="h-10 bg-[#0a1520] border border-[#222] rounded-sm animate-pulse" />)}
          </div>
        ) : agents.length === 0 ? (
          <div className="text-xs text-[#555] font-mono">No agents connected.</div>
        ) : (
          <div className="space-y-1">
            {agents.map((a) => (
              <button key={a.namespace}
                onClick={() => setSelectedNs(a.namespace)}
                className={`w-full text-left px-3 py-2.5 rounded-sm border text-xs transition-colors ${selectedNs === a.namespace ? "border-[#D4AF37]/40 bg-[#D4AF37]/5 text-[#D4AF37]" : "border-[#222] text-[#888] hover:border-[#D4AF37]/20 hover:text-[#D4AF37]/70"}`}>
                <div className="font-bold uppercase tracking-wider truncate">{a.namespace}</div>
                <div className="flex items-center gap-1 mt-0.5 text-[#555]">
                  <TbDatabase size={9} /> {a.count} nodes
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Agent settings panel */}
      <div className="flex-1 min-w-0">
        {!selectedNs ? (
          <div className="text-sm text-[#555] font-mono mt-8">Select an agent to configure.</div>
        ) : (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 bg-[#050a0f] border border-[#00F0FF]/30 rounded-sm flex items-center justify-center">
                <TbRobot size={16} className="text-[#00F0FF]" />
              </div>
              <div>
                <div className="text-white font-bold uppercase tracking-widest">{selectedNs}</div>
                <div className="text-xs text-[#555]">{agents.find((a) => a.namespace === selectedNs)?.count ?? 0} memory nodes</div>
              </div>
            </div>

            {/* D3 Decay Curve — ABOVE controls */}
            <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-sm p-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-[#888] uppercase tracking-widest">Heat Decay Projection</h4>
                <span className="text-[10px] text-[#555] font-mono">Lifetime: {LIFETIME_OPTIONS[lifetimeIdx].label}</span>
              </div>
              {effectiveProfiles && thermoConfig.data ? (
                <DecayCurve decayProfiles={effectiveProfiles as Record<string, DecayProfile>} lifetimeMultiplier={LIFETIME_OPTIONS[lifetimeIdx].multiplier} />
              ) : (
                <div className="h-[220px] flex items-center justify-center text-[#555] text-xs animate-pulse">Loading decay data…</div>
              )}
            </div>

            {/* Memory Lifetime Slider */}
            <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-sm p-5 mb-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-xs font-bold text-[#888] uppercase tracking-widest mb-1">Memory Lifetime</h4>
                  <p className="text-[10px] text-[#555]">
                    Sets a global half-life multiplier applied to all memory types proportionally.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {saved && <span className="text-xs text-[#22c55e] flex items-center gap-1"><TbCheck size={12} /> Applied</span>}
                  <button onClick={handleApplyLifetime} disabled={saving || !effectiveProfiles}
                    className="px-3 py-1.5 text-xs bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] rounded hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-30">
                    {saving ? "Saving…" : "Apply"}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-2">
                <input type="range" min={0} max={5} step={1} value={lifetimeIdx}
                  onChange={(e) => setLifetimeIdx(parseInt(e.target.value))}
                  className="flex-1 accent-[#D4AF37]" />
              </div>
              <div className="flex justify-between text-[10px] text-[#555] font-mono px-0.5">
                {LIFETIME_OPTIONS.map((opt, i) => (
                  <span key={opt.label} className={lifetimeIdx === i ? "text-[#D4AF37]" : ""}>{opt.label}</span>
                ))}
              </div>
            </div>

            {/* Per-type preview */}
            {effectiveProfiles && (
              <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-sm overflow-hidden">
                <div className="p-3 border-b border-[#222]">
                  <h4 className="text-xs font-bold text-[#888] uppercase tracking-widest">Effective Half-Lives</h4>
                </div>
                {MEMORY_TYPES.map((type) => {
                  const profile = (effectiveProfiles as Record<string, DecayProfile>)[type];
                  if (!profile) return null;
                  return (
                    <div key={type} className="flex items-center gap-3 px-4 py-2.5 border-b border-[#1a1a1a] last:border-b-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: TYPE_COLORS[type] }} />
                      <span className="text-xs text-[#888] w-24">{TYPE_LABELS[type]}</span>
                      <span className="text-xs font-mono text-white">{secsToHumanLabel(profile.half_life_secs)}</span>
                      <span className="text-[10px] text-[#555] ml-auto">floor {profile.floor.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS SUB-TAB: GENERAL (Thermo Engine + Danger Zone)
// ═══════════════════════════════════════════════════════════════════════════

function GeneralSubTab() {
  const { thermoConfig, updateThermoConfig, recallAnalytics } = useSulcusApi();
  const [thermoEdits, setThermoEdits] = useState<ThermoConfig | null>(null);
  const [thermoSaving, setThermoSaving] = useState(false);
  const [thermoSaved, setThermoSaved] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearDone, setClearDone] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  useEffect(() => {
    if (thermoConfig.data?.config && !thermoEdits) {
      setThermoEdits(structuredClone(thermoConfig.data.config));
    }
  }, [thermoConfig.data, thermoEdits]);

  const thermoIsDirty = thermoEdits && thermoConfig.data?.config &&
    JSON.stringify(thermoEdits) !== JSON.stringify(thermoConfig.data.config);

  const handleThermoSave = async () => {
    if (!thermoEdits) return;
    setThermoSaving(true); setThermoSaved(false);
    try {
      await updateThermoConfig.mutateAsync(thermoEdits);
      setThermoSaved(true); setTimeout(() => setThermoSaved(false), 3000);
    } finally { setThermoSaving(false); }
  };

  const handleThermoReset = () => {
    if (thermoConfig.data?.defaults) setThermoEdits(structuredClone(thermoConfig.data.defaults));
  };

  const updateDecayProfile = (type: string, updated: DecayProfile) => {
    if (!thermoEdits) return;
    setThermoEdits({ ...thermoEdits, decay_profiles: { ...thermoEdits.decay_profiles, [type]: updated } });
  };

  const handleClearAll = async () => {
    setClearConfirm(false); setClearError(null);
    try {
      await apiFetch("/api/v1/agent/nodes/bulk", { method: "POST", body: JSON.stringify({ delete_all: true }) });
      setClearDone(true);
    } catch (err) { setClearError(err instanceof Error ? err.message : "Unknown error"); }
  };

  return (
    <div className="space-y-8">
      {/* Decay Profiles */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TbFlame size={16} className="text-[#D4AF37]" />
            <h3 className="text-sm font-bold text-[#888] tracking-widest uppercase">Thermodynamic Engine</h3>
            {thermoConfig.data?.custom && (
              <span className="text-[10px] bg-[#D4AF37]/10 text-[#D4AF37] px-2 py-0.5 rounded border border-[#D4AF37]/20">Custom</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {thermoSaved && <span className="text-xs text-[#22c55e] flex items-center gap-1"><TbCheck size={12} /> Saved</span>}
            <button onClick={handleThermoReset} className="text-xs text-[#888] hover:text-[#ededed] transition-colors" title="Reset to defaults">
              <TbRefresh size={14} />
            </button>
            <button onClick={handleThermoSave} disabled={!thermoIsDirty || thermoSaving}
              className="px-3 py-1 text-xs bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] rounded hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-30">
              {thermoSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {thermoConfig.isLoading && (
          <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg p-8 animate-pulse">
            <div className="h-3 bg-[#050a0f] rounded w-1/3 mb-4" /><div className="h-3 bg-[#050a0f] rounded w-2/3" />
          </div>
        )}

        {thermoEdits && (
          <>
            <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden mb-4">
              <div className="p-3 border-b border-[#222]">
                <h4 className="text-xs font-bold text-[#888] uppercase tracking-widest">Decay Profiles</h4>
                <p className="text-[10px] text-[#555] mt-1">How fast each memory type cools. Half-life sets the time to reach 50% heat.</p>
              </div>
              {MEMORY_TYPES.map((type) => thermoEdits.decay_profiles[type] ? (
                <DecayProfileRow key={type} type={type} profile={thermoEdits.decay_profiles[type]}
                  onChange={(updated) => updateDecayProfile(type, updated)} />
              ) : null)}
            </div>

            {/* Resonance */}
            <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden mb-4">
              <div className="p-3 border-b border-[#222]">
                <h4 className="text-xs font-bold text-[#888] uppercase tracking-widest">Resonance</h4>
                <p className="text-[10px] text-[#555] mt-1">How heat spreads between connected memories.</p>
              </div>
              <div className="grid grid-cols-2 gap-4 p-4">
                {[
                  { key: "spread_factor" as const, label: "Spread Factor", min: 0, max: 1, step: 0.05 },
                  { key: "damping" as const, label: "Damping", min: 0, max: 1, step: 0.05 },
                  { key: "depth" as const, label: "Depth (hops)", min: 1, max: 5, step: 1 },
                  { key: "thermal_gate" as const, label: "Thermal Gate", min: 0, max: 0.5, step: 0.01 },
                ].map(({ key, label, min, max, step }) => (
                  <div key={key}>
                    <label className="text-[10px] text-[#888] uppercase tracking-wide block mb-1">{label}</label>
                    <div className="flex items-center gap-2">
                      <input type="range" min={min} max={max} step={step} value={thermoEdits.resonance[key]}
                        onChange={(e) => setThermoEdits({ ...thermoEdits, resonance: { ...thermoEdits.resonance, [key]: parseFloat(e.target.value) } })}
                        className="flex-1 accent-[#D4AF37]" />
                      <span className="text-xs font-mono text-[#888] w-8">
                        {key === "depth" ? thermoEdits.resonance[key] : (thermoEdits.resonance[key] as number).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Consolidation + Active Index */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden">
                <div className="p-3 border-b border-[#222]">
                  <h4 className="text-xs font-bold text-[#888] uppercase tracking-widest">Consolidation</h4>
                </div>
                <div className="p-4 space-y-3">
                  {[
                    { key: "cold_threshold" as const, label: "Cold Threshold", min: 0.01, max: 0.5, step: 0.01, fmt: (v: number) => v.toFixed(2) },
                    { key: "cold_count_trigger" as const, label: "Cold Count Trigger", min: 5, max: 100, step: 5, fmt: (v: number) => String(v) },
                  ].map(({ key, label, min, max, step, fmt }) => (
                    <div key={key}>
                      <label className="text-[10px] text-[#888] uppercase tracking-wide block mb-1">{label}</label>
                      <div className="flex items-center gap-2">
                        <input type="range" min={min} max={max} step={step} value={thermoEdits.consolidation[key]}
                          onChange={(e) => setThermoEdits({ ...thermoEdits, consolidation: { ...thermoEdits.consolidation, [key]: parseFloat(e.target.value) } })}
                          className="flex-1 accent-[#D4AF37]" />
                        <span className="text-xs font-mono text-[#888] w-8">{fmt(thermoEdits.consolidation[key] as number)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden">
                <div className="p-3 border-b border-[#222]">
                  <h4 className="text-xs font-bold text-[#888] uppercase tracking-widest">Active Index</h4>
                </div>
                <div className="p-4 space-y-3">
                  {[
                    { key: "max_nodes" as const, label: "Max Nodes", min: 10, max: 200, step: 10, fmt: (v: number) => String(v) },
                    { key: "context_budget_chars" as const, label: "Context Budget", min: 2000, max: 50000, step: 1000, fmt: (v: number) => `${(v / 1000).toFixed(0)}k` },
                  ].map(({ key, label, min, max, step, fmt }) => (
                    <div key={key}>
                      <label className="text-[10px] text-[#888] uppercase tracking-wide block mb-1">{label}</label>
                      <div className="flex items-center gap-2">
                        <input type="range" min={min} max={max} step={step} value={thermoEdits.active_index[key]}
                          onChange={(e) => setThermoEdits({ ...thermoEdits, active_index: { ...thermoEdits.active_index, [key]: parseInt(e.target.value) } })}
                          className="flex-1 accent-[#D4AF37]" />
                        <span className="text-xs font-mono text-[#888] w-8">{fmt(thermoEdits.active_index[key] as number)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Recall Analytics */}
            {recallAnalytics.data && recallAnalytics.data.stats.length > 0 && (
              <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden mb-4">
                <div className="p-3 border-b border-[#222]">
                  <h4 className="text-xs font-bold text-[#888] uppercase tracking-widest">Recall Quality ({recallAnalytics.data.period})</h4>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-5 gap-2">
                    {recallAnalytics.data.stats.map((stat) => (
                      <div key={stat.memory_type} className="text-center">
                        <span className="text-xs font-bold block mb-1" style={{ color: TYPE_COLORS[stat.memory_type] || "#888" }}>
                          {TYPE_LABELS[stat.memory_type] || stat.memory_type}
                        </span>
                        <span className="text-lg font-mono text-[#ededed]">{(stat.relevance_ratio * 100).toFixed(0)}%</span>
                        <span className="text-[10px] text-[#555] block">{stat.total_recalls} recalls</span>
                      </div>
                    ))}
                  </div>
                  {recallAnalytics.data.suggestions.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[#222]">
                      <p className="text-[10px] text-[#888] uppercase tracking-widest mb-1">Suggestions</p>
                      {recallAnalytics.data.suggestions.map((s, i) => <p key={i} className="text-xs text-[#D4AF37] mt-1">{s}</p>)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Danger Zone */}
      <div>
        <h3 className="text-sm font-bold text-red-500/70 tracking-widest uppercase mb-4">Danger Zone</h3>
        <div className="border border-red-500/20 rounded-lg p-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="font-bold text-sm text-red-400 mb-1">Clear All Memories</p>
              <p className="text-xs text-[#888]">Permanently delete all memory nodes from your graph. This action cannot be undone.</p>
              {clearDone && <p className="text-xs text-[#22c55e] mt-2 flex items-center gap-1"><TbCheck size={14} /> All memories cleared.</p>}
              {clearError && <p className="text-xs text-red-400 mt-2">{clearError}</p>}
            </div>
            <button onClick={() => setClearConfirm(true)} disabled={clearDone}
              className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border border-red-500/30 rounded text-red-400 text-sm hover:bg-red-500/10 transition-colors disabled:opacity-50">
              <TbTrash size={14} /> Clear All
            </button>
          </div>
        </div>
      </div>

      {clearConfirm && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-[#0a1520] border border-[#222] rounded-lg p-6 w-full max-w-md font-mono">
            <div className="flex items-center gap-2 mb-2">
              <TbAlertTriangle size={20} className="text-red-400" />
              <h3 className="font-bold text-lg">Clear All Memories</h3>
            </div>
            <p className="text-[#888] text-sm mb-6">This will permanently delete ALL memory nodes. This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setClearConfirm(false)} className="flex-1 py-2 border border-[#222] rounded text-[#888] text-sm hover:text-[#ededed] transition-colors">Cancel</button>
              <button onClick={handleClearAll} className="flex-1 py-2 rounded text-sm bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors">Yes, clear all</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: SETTINGS (with sub-tabs)
// ═══════════════════════════════════════════════════════════════════════════

function SettingsTab({ initialSubTab }: { initialSubTab?: string }) {
  const [subTab, setSubTab] = useState(initialSubTab || "general");

  return (
    <div>
      {/* Sub-tab bar */}
      <div className="flex items-center gap-0 border-b border-[#222] mb-8">
        {[
          { id: "general", label: "General" },
          { id: "agents", label: "Agents" },
          { id: "api", label: "API" },
        ].map((t) => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={`px-5 py-2.5 text-xs uppercase tracking-widest transition-colors border-b-2 -mb-px ${
              subTab === t.id
                ? "border-[#D4AF37] text-[#D4AF37]"
                : "border-transparent text-[#555] hover:text-[#888]"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "general" && <GeneralSubTab />}
      {subTab === "agents" && <AgentsSubTab />}
      {subTab === "api" && <ApiSubTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOT: AccountContent
// ═══════════════════════════════════════════════════════════════════════════

function AccountContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "profile");

  // Update tab when URL param changes
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t) setTab(t);
  }, [searchParams]);

  const tabs = [
    { id: "profile", label: "Profile", icon: <TbUserCircle size={14} /> },
    { id: "billing", label: "Billing", icon: <TbCreditCard size={14} /> },
    { id: "settings", label: "Settings", icon: <TbSettings size={14} /> },
  ];

  return (
    <div className="font-mono text-[#ededed]">
      <h1 className="text-3xl font-bold mb-8 tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
        <TbUserCircle size={24} className="text-[#00F0FF]" />
        {user?.email || "Account"}
      </h1>

      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-[#D4AF37]/20 mb-10">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-6 py-3 text-xs uppercase tracking-widest transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? "border-[#D4AF37] text-[#D4AF37]"
                : "border-transparent text-[#555] hover:text-[#888]"
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" && <ProfileTab />}
      {tab === "billing" && <BillingTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="text-[#888] font-mono animate-pulse p-8">Loading…</div>}>
      <AccountContent />
    </Suspense>
  );
}
