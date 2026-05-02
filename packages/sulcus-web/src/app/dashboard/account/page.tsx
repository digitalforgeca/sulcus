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
  TbBolt,
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
  TbEye,
  TbEyeOff,
} from "react-icons/tb";
import { SERVER_URL, authHeaders, apiFetch } from "@/lib/api";
import { TIERS, PAID_TIER_KEYS, getTier, normalizeTierKey, type PricingTier } from "@/lib/pricing";
import { getAccessToken } from "@/lib/auth";
import { useApiKeys, useThermoConfig, useUsage, useRecallAnalytics, type ThermoConfig, type DecayProfile } from "@/hooks/useSulcusApi";
import * as d3 from "d3";

// ── Types ────────────────────────────────────────────────────────────────────

interface OrgMember {
  id: string;
  email: string;
  name: string | null;
  username: string | null;
  role: string;
}

interface OrgInfo {
  tenant_id: string;
  kc_org_id: string | null;
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

const TIER_COLORS: Record<string, { color: string; icon: React.ReactNode; border: string }> = {
  free: { color: "#00F0FF", icon: <TbLock size={14} />, border: "border-[#00F0FF]/50" },
  neuron: { color: "#4ADE80", icon: <TbBolt size={14} />, border: "border-green-400/50" },
  cortex: { color: "#D4AF37", icon: <TbSparkles size={14} />, border: "border-[#D4AF37]/50" },
  enterprise: { color: "#8B5CF6", icon: <TbCrown size={14} />, border: "border-purple-500/50" },
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
  const colors = TIER_COLORS[tier] || TIER_COLORS.free;
  const tierData = getTier(tier);
  const label = tierData?.name || tier;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 border rounded-full text-xs uppercase tracking-widest font-bold ${colors.border}`}
      style={{ color: colors.color }}
    >
      {colors.icon} {label}
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
  return normalizeTierKey(raw) || "free";
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
// COMPONENT: Change Password Form
// ═══════════════════════════════════════════════════════════════════════════

const KEYCLOAK_AUTHORITY = "https://sulcus-keycloak.calmstone-a7a24a97.westus.azurecontainerapps.io/realms/sulcus";

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(""); setErrorMsg("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setErrorMsg("All fields are required."); return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg("New passwords do not match."); return;
    }
    if (newPassword.length < 8) {
      setErrorMsg("New password must be at least 8 characters."); return;
    }

    setSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) { setErrorMsg("Not authenticated."); return; }

      const res = await fetch(`${KEYCLOAK_AUTHORITY}/account/credentials/password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmation: confirmPassword,
        }),
      });

      if (res.ok || res.status === 204) {
        setSuccessMsg("Password updated successfully.");
        setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      } else {
        const data = await res.json().catch(() => ({}));
        const msg = (data as { errorMessage?: string; error?: string }).errorMessage
          || (data as { errorMessage?: string; error?: string }).error
          || `Error ${res.status}`;
        setErrorMsg(`Failed: ${msg}`);
      }
    } catch (err) {
      setErrorMsg((err as Error).message || "Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-[#0a1520] p-6 border border-[#D4AF37]/30 flex flex-col relative rounded-sm">
      <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]" />
      <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]" />
      <h3 className="text-lg font-bold text-white mb-2 tracking-widest uppercase flex items-center gap-2">
        <TbLock size={16} className="text-[#D4AF37]" /> Change Password
      </h3>
      <p className="text-sm text-[#888] mb-5">Update your account password.</p>
      <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
        {/* Current Password */}
        <div className="relative">
          <label className="text-[10px] text-[#888] uppercase tracking-widest block mb-1">Current Password</label>
          <div className="relative">
            <input
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-[#111820] border border-[#333] text-white px-3 py-2 text-sm focus:outline-none focus:border-[#D4AF37]/50 rounded-sm pr-10"
              placeholder="••••••••"
            />
            <button type="button" onClick={() => setShowCurrent((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#888]">
              {showCurrent ? <TbEyeOff size={14} /> : <TbEye size={14} />}
            </button>
          </div>
        </div>
        {/* New Password */}
        <div>
          <label className="text-[10px] text-[#888] uppercase tracking-widest block mb-1">New Password</label>
          <div className="relative">
            <input
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full bg-[#111820] border border-[#333] text-white px-3 py-2 text-sm focus:outline-none focus:border-[#D4AF37]/50 rounded-sm pr-10"
              placeholder="••••••••"
            />
            <button type="button" onClick={() => setShowNew((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#888]">
              {showNew ? <TbEyeOff size={14} /> : <TbEye size={14} />}
            </button>
          </div>
        </div>
        {/* Confirm Password */}
        <div>
          <label className="text-[10px] text-[#888] uppercase tracking-widest block mb-1">Confirm New Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            className="w-full bg-[#111820] border border-[#333] text-white px-3 py-2 text-sm focus:outline-none focus:border-[#D4AF37]/50 rounded-sm"
            placeholder="••••••••"
          />
        </div>
        {errorMsg && <p className="text-red-400 text-xs">{errorMsg}</p>}
        {successMsg && <p className="text-green-400 text-xs flex items-center gap-1"><TbCheck size={12} />{successMsg}</p>}
        <button
          type="submit"
          disabled={saving}
          className="mt-1 bg-transparent border border-[#D4AF37] text-[#D4AF37] px-4 py-2 font-bold hover:bg-[#D4AF37] hover:text-[#050a0f] transition-all tracking-widest text-center text-sm rounded-sm disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? <><TbLoader2 size={14} className="animate-spin" /> Updating…</> : "UPDATE PASSWORD"}
        </button>
      </form>
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
  const [inviteRetryAfter, setInviteRetryAfter] = useState(0); // countdown seconds
  const [reinvitingId, setReinvitingId] = useState<string | null>(null);
  const [memberToast, setMemberToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [reinviteRetryAfter, setReinviteRetryAfter] = useState(0);
  const [platformEmail, setPlatformEmail] = useState("");
  const [platformInviting, setPlatformInviting] = useState(false);
  const [platformError, setPlatformError] = useState("");
  const [platformSuccess, setPlatformSuccess] = useState("");
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

  const startRetryCountdown = (
    secs: number,
    setter: React.Dispatch<React.SetStateAction<number>>
  ) => {
    setter(secs);
    const tick = setInterval(() => {
      setter((prev) => {
        if (prev <= 1) { clearInterval(tick); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const fmtCountdown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || inviteRetryAfter > 0) return;
    setInviting(true); setInviteError(""); setInviteSuccess("");
    try {
      const hdrs = await authHeaders();
      const res = await fetch(`${SERVER_URL}/api/v1/org/invite`, {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        const sentEmail = inviteEmail.trim();
        setInviteEmail("");
        setInviteSuccess(`Invitation sent to ${sentEmail}`);
        setTimeout(() => setInviteSuccess(""), 5000);
        const r2 = await fetch(`${SERVER_URL}/api/v1/org`, { headers: hdrs });
        if (r2.ok) {
          const orgData: OrgInfo = await r2.json();
          orgData.plan_tier = normalizeTier(orgData.plan_tier);
          setOrg(orgData);
        }
      } else if (res.status === 429 && (data.error === "rate_limited" || data.error === "cooldown")) {
        setInviteError(data.message || "Rate limit reached");
        startRetryCountdown(data.retry_after_secs ?? 300, setInviteRetryAfter);
      } else {
        setInviteError(data.message || data.error || "Failed to invite");
      }
    } catch { setInviteError("Network error"); }
    finally { setInviting(false); }
  };

  const handleReinvite = async (memberId: string, email: string) => {
    if (reinviteRetryAfter > 0) return;
    setReinvitingId(memberId);
    setMemberToast(null);
    try {
      const hdrs = await authHeaders();
      const res = await fetch(`${SERVER_URL}/api/v1/org/reinvite`, {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setMemberToast({ type: "success", msg: `Invitation resent to ${email}` });
        setTimeout(() => setMemberToast(null), 5000);
        const r2 = await fetch(`${SERVER_URL}/api/v1/org`, { headers: hdrs });
        if (r2.ok) {
          const orgData: OrgInfo = await r2.json();
          orgData.plan_tier = normalizeTier(orgData.plan_tier);
          setOrg(orgData);
        }
      } else if (res.status === 429 && (data.error === "rate_limited" || data.error === "cooldown")) {
        setMemberToast({ type: "error", msg: data.message || "Rate limit reached" });
        startRetryCountdown(data.retry_after_secs ?? 300, setReinviteRetryAfter);
      } else {
        setMemberToast({ type: "error", msg: data.message || data.error || "Failed to reinvite" });
      }
    } catch { setMemberToast({ type: "error", msg: "Network error" }); }
    finally { setReinvitingId(null); }
  };

  const handlePlatformInvite = async () => {
    if (!platformEmail.trim()) return;
    setPlatformInviting(true); setPlatformError(""); setPlatformSuccess("");
    try {
      const hdrs = await authHeaders();
      const res = await fetch(`${SERVER_URL}/api/v1/admin/invite/platform`, {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ email: platformEmail.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.invite_url) {
          try { await navigator.clipboard.writeText(data.invite_url); } catch {}
        }
        const msg = data.invite_url
          ? `Invitation sent! Link copied to clipboard.`
          : `Invitation sent to ${platformEmail}`;
        setPlatformSuccess(msg); setPlatformEmail("");
      } else {
        setPlatformError(data.message || data.error || "Failed to send invite");
      }
    } catch { setPlatformError("Network error"); }
    finally { setPlatformInviting(false); }
  };

  const handleRemove = async (memberId: string, email: string) => {
    if (!confirm(`Remove ${email} from your organization?`)) return;
    try {
      const hdrs = await authHeaders();
      const res = await fetch(`${SERVER_URL}/api/v1/org/members/${memberId}`, {
        method: "DELETE", headers: hdrs,
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
      const res = await fetch(`${SERVER_URL}/api/v1/org`, {
        method: "PATCH", headers: hdrs, body: JSON.stringify({ org_name: orgName }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        alert(`Failed to save: ${errText}`);
        return;
      }
      setEditingName(false);
      if (org) setOrg({ ...org, org_name: orgName });
    } catch (e) { alert(`Failed to save: ${(e as Error).message}`); }
  };

  const tier = normalizeTier(
    org?.plan_tier || user?.roles?.find((r) => ["enterprise", "cortex", "neuron"].includes(r)) || "free"
  );
  // max_seats: null = unlimited (enterprise), -1 = unlimited (legacy), positive = capped
  const isUnlimitedSeats = org?.max_seats == null || org.max_seats < 0;
  const seatsPct = isUnlimitedSeats ? 0 : (org?.max_seats ? Math.min((org.seats_used / org.max_seats) * 100, 100) : 0);

  return (
    <div className="">
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
          {org && (
            <span className="text-xs text-[#888] font-mono">{org.seats_used}/{isUnlimitedSeats ? "∞" : org.max_seats} seats</span>
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

            {org && (
              <div className="mb-6">
                <div className="flex justify-between mb-2">
                  <span className="text-xs uppercase tracking-wider text-[#888]">Seats</span>
                  <span className="text-xs font-mono text-[#D4AF37]">{org.seats_used} / {isUnlimitedSeats ? "∞" : org.max_seats}</span>
                </div>
                {!isUnlimitedSeats && (
                  <div className="w-full bg-black h-1.5 rounded-full">
                    <div className={`h-1.5 rounded-full transition-all duration-500 ${seatsPct > 80 ? "bg-[#D4AF37] shadow-[0_0_8px_#D4AF37]" : "bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"}`}
                      style={{ width: `${seatsPct}%` }} />
                  </div>
                )}
              </div>
            )}

            <div className="mb-4">
              <span className="text-[#888] uppercase tracking-wider text-xs flex items-center gap-1.5 mb-3"><TbUsers size={12} /> Members</span>
              {(org?.members?.length ?? 0) === 0 ? (
                <div className="mb-4 py-4 px-3 bg-[#111820] border border-[#D4AF37]/10 rounded-sm text-center">
                  <TbUsers size={24} className="text-[#333] mx-auto mb-2" />
                  <p className="text-[#555] text-sm">Invite your team members to collaborate</p>
                </div>
              ) : (
                <div className="space-y-2 mb-4">
                  {org?.members.map((member) => (
                    <div key={member.id || member.email}
                      className="flex items-center justify-between py-2 px-3 bg-[#111820] border border-[#D4AF37]/10 rounded-sm group">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${member.role === "owner" ? "bg-[#D4AF37]" : "bg-[#00F0FF]"}`} />
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm text-white truncate">{member.email}</span>
                          {(member.name || (member.username && member.username !== member.email)) && (
                            <span className="text-xs text-[#555] truncate">
                              {member.name ? member.name : ""}
                              {member.name && member.username && member.username !== member.email ? " · " : ""}
                              {member.username && member.username !== member.email ? `@${member.username}` : ""}
                            </span>
                          )}
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 border rounded-full uppercase tracking-widest flex-shrink-0 ${member.role === "owner" ? "border-[#D4AF37]/50 text-[#D4AF37]" : "border-[#333] text-[#888]"}`}>
                          {member.role}
                        </span>
                      </div>
                      {member.role !== "owner" && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                          <button
                            onClick={() => handleReinvite(member.id, member.email)}
                            disabled={reinvitingId === member.id || reinviteRetryAfter > 0}
                            title={reinviteRetryAfter > 0 ? `Retry in ${fmtCountdown(reinviteRetryAfter)}` : "Resend invitation"}
                            className="text-[#555] hover:text-[#00F0FF] p-1 disabled:opacity-50 transition-colors">
                            {reinvitingId === member.id
                              ? <TbLoader2 size={14} className="animate-spin" />
                              : <TbRefresh size={14} />}
                          </button>
                          <button onClick={() => handleRemove(member.id, member.email)}
                            className="text-[#333] hover:text-red-500 transition-all p-1">
                            <TbTrash size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {memberToast && (
                    <p className={`text-xs mt-1 ${memberToast.type === "success" ? "text-green-400" : "text-red-400"}`}>
                      {memberToast.msg}
                    </p>
                  )}
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
                  <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim() || inviteRetryAfter > 0}
                    className="px-4 py-2 bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30 text-xs uppercase tracking-widest hover:bg-[#D4AF37]/30 transition-colors disabled:opacity-50 flex items-center gap-2 rounded-sm whitespace-nowrap">
                    {inviting
                      ? <TbLoader2 size={14} className="animate-spin" />
                      : inviteRetryAfter > 0
                        ? null
                        : <TbPlus size={14} />}
                    {inviteRetryAfter > 0 ? `Retry in ${fmtCountdown(inviteRetryAfter)}` : "Invite"}
                  </button>
                </div>
                {inviteError && <p className="text-red-400 text-xs mt-2">{inviteError}</p>}
                {inviteSuccess && <p className="text-green-400 text-xs mt-2">{inviteSuccess}</p>}
              </div>

            </div>
          </>
        )}
      </Section>

      {/* Platform Invite Card — invite someone to create their own account */}
      <Section title={
        <h2 className="text-xl font-bold text-white uppercase tracking-widest flex items-center gap-2">
          <TbMail size={18} className="text-[#00F0FF]" /> Invite to Platform
        </h2>
      }>
        <p className="text-[#555] text-xs mb-4">Send someone an invite to create their own Sulcus account — separate from your workspace.</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <TbMail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
            <input value={platformEmail} onChange={(e) => { setPlatformEmail(e.target.value); setPlatformError(""); setPlatformSuccess(""); }}
              onKeyDown={(e) => e.key === "Enter" && handlePlatformInvite()}
              placeholder="friend@example.com"
              className="w-full bg-[#111820] border border-[#00F0FF]/20 text-white text-sm pl-9 pr-3 py-2 focus:outline-none focus:border-[#00F0FF]/50 placeholder-[#333] rounded-sm" />
          </div>
          <button onClick={handlePlatformInvite} disabled={platformInviting || !platformEmail.trim()}
            className="px-4 py-2 bg-[#00F0FF]/10 text-[#00F0FF] border border-[#00F0FF]/30 text-xs uppercase tracking-widest hover:bg-[#00F0FF]/20 transition-colors disabled:opacity-50 flex items-center gap-2 rounded-sm">
            {platformInviting ? <TbLoader2 size={14} className="animate-spin" /> : <TbMail size={14} />}
            Send Invite
          </button>
        </div>
        {platformError && <p className="text-red-400 text-xs mt-2">{platformError}</p>}
        {platformSuccess && <p className="text-[#00F0FF] text-xs mt-2 break-all">{platformSuccess}</p>}
      </Section>

      {/* Security + Session */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Change Password */}
        <ChangePasswordForm />

        {/* Session Control */}
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
  // Stripe product fetching removed — plans now rendered from shared pricing.ts
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
  // Server returns 0 or very large values for unlimited; -1 from Stripe also means unlimited
  const rawOps = serverLimits?.ops_limit ?? tierDefaults.sync_requests;
  const rawNodes = serverLimits?.nodes_limit ?? tierDefaults.nodes;
  const isOpsUnlimited = rawOps <= 0 || rawOps >= 9_000_000_000;
  const isNodesUnlimited = rawNodes <= 0 || rawNodes >= 9_000_000_000;
  const limits = { sync_requests: isOpsUnlimited ? Infinity : rawOps, nodes: isNodesUnlimited ? Infinity : rawNodes };
  const syncPct = usage && !isOpsUnlimited ? Math.min((usage.sync_requests / limits.sync_requests) * 100, 100) : 0;
  const nodesPct = usage && !isNodesUnlimited ? Math.min((usage.nodes_added / limits.nodes) * 100, 100) : 0;



  return (
    <div className="">
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
            : (() => { const t = getTier(currentTier || "free"); return t ? `${t.emoji} ${t.name}` : currentTier; })()}
        </h2>
      }>
        <p className="text-[#888] mb-6 text-sm">
          {!loadingTier && currentTier && (getTier(currentTier)?.description || "")}
        </p>
        {loadingUsage ? (
          <div className="text-[#888] animate-pulse font-mono text-sm">Loading usage…</div>
        ) : usage ? (
          <div className="space-y-4 max-w-lg">
            {[
              { label: "Sync Requests (this month)", value: usage.sync_requests, limit: limits.sync_requests, pct: syncPct, unlimited: isOpsUnlimited },
              { label: "Nodes Added (this month)", value: usage.nodes_added, limit: limits.nodes, pct: nodesPct, unlimited: isNodesUnlimited },
            ].map(({ label, value, limit, pct, unlimited }) => (
              <div key={label} className="bg-[#111820] p-4 border border-[#D4AF37]/20">
                <div className="flex justify-between mb-2">
                  <span className="text-xs uppercase tracking-wider text-[#888]">{label}</span>
                  <span className="text-xs font-bold text-[#D4AF37]">
                    {value.toLocaleString()} / {unlimited ? "Unlimited" : limit.toLocaleString()}
                  </span>
                </div>
                {!unlimited && (
                  <div className="w-full bg-black h-1">
                    <div className={`h-1 transition-all duration-500 ${pct > 80 ? "bg-[#D4AF37] shadow-[0_0_8px_#D4AF37]" : "bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"}`}
                      style={{ width: `${pct}%` }} />
                  </div>
                )}
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

      {/* Plans — rendered from shared pricing.ts (single source of truth with /pricing page) */}
      <h2 className="text-2xl font-bold mb-6 tracking-widest text-white uppercase">Plans</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        {TIERS.map((tier) => {
          const isActive = tier.key === currentTier;
          const colors = TIER_COLORS[tier.key] || TIER_COLORS.free;
          const priceStr = tier.price === 0 ? "Free" : `$${tier.price}`;

          return (
            <div key={tier.key} className={`bg-[#0a1520] p-6 border relative flex flex-col ${isActive ? "border-[#00F0FF]/50" : tier.highlighted ? "border-[#D4AF37]/40" : "border-[#333]"}`}>
              <div className={`absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent ${isActive ? "via-[#00F0FF]" : tier.highlighted ? "via-[#D4AF37]" : "via-[#555]"} to-transparent`} />
              <div className={`text-xs uppercase tracking-widest mb-2 ${isActive ? "text-[#00F0FF]" : tier.highlighted ? "text-[#D4AF37]" : "text-[#555]"}`}>
                {isActive ? "Current Plan" : tier.badge || tier.dashboardLabel || ""}
              </div>
              <h3 className={`text-lg font-bold tracking-widest uppercase mb-1`} style={{ color: tier.highlighted ? "#D4AF37" : "white" }}>
                {tier.emoji ? `${tier.emoji} ` : ""}{tier.name}
              </h3>
              <div className="text-2xl font-mono text-white mb-3">{priceStr}{tier.price > 0 && <span className="text-sm text-[#888]">/month</span>}</div>
              <ul className="text-[#888] text-sm space-y-2 flex-1 mb-4">
                {tier.features.map((feat, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span style={{ color: colors.color }}>✓</span> {feat}
                  </li>
                ))}
              </ul>
              {isActive ? (
                <div className="w-full border border-[#00F0FF]/30 text-[#00F0FF] px-4 py-2 text-center text-sm tracking-widest uppercase">Active</div>
              ) : tier.stripePriceId ? (
                <button onClick={() => handleUpgrade(tier.stripePriceId!, `Sulcus ${tier.name}`, priceStr)} disabled={loading}
                  className={`w-full px-4 py-2 text-sm font-bold tracking-widest uppercase transition-all disabled:opacity-50 ${tier.highlighted ? "bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-[#050a0f] hover:brightness-110" : "border border-[#555] text-[#888] hover:border-[#D4AF37] hover:text-[#D4AF37]"}`}>
                  {loading ? "Processing…" : tier.cta}
                </button>
              ) : (
                <div className={`w-full border px-4 py-2 text-center text-sm tracking-widest uppercase ${isActive ? "border-[#00F0FF]/30 text-[#00F0FF]" : "border-[#333] text-[#555]"}`}>
                  {tier.cta}
                </div>
              )}
            </div>
          );
        })}
      </div>

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
  const { apiKeys, createKey, revokeKey } = useApiKeys();
  const usage = useUsage();
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
  const { thermoConfig, updateThermoConfig } = useThermoConfig();
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
  const { thermoConfig, updateThermoConfig } = useThermoConfig();
  const recallAnalytics = useRecallAnalytics();
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
