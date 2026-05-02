'use client';

import { useEffect, useState } from "react";
import { TbFlame } from "react-icons/tb";
import {
  GiCrown,
  GiBrain,
  GiMagnifyingGlass,
  GiSpiderWeb,
  GiTrophy,
  GiScrollUnfurled,
  GiRobotGolem,
  GiCrystalBall,
  GiSwordsPower,
  GiOwl,
  GiMagicSwirl,
  GiLaurelCrown,
  GiBookCover,
  GiChessKnight,
  GiLightningBow,
  GiCog,
} from "react-icons/gi";
import type { IconType } from "react-icons";
import { useGamification } from "@/hooks/useSulcusApi";
import { apiFetch } from "@/lib/api";
import GoldCard from "@/components/GoldCard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NamespaceCount {
  namespace: string;
  count: number;
}

interface DashboardData {
  namespace_counts?: NamespaceCount[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_BADGES = [
  "First Memory",
  "100 Syncs",
  "Graph Architect",
  "Curator",
  "Early Adopter",
];

/** Cycle of game icons for agents (one per namespace, cycling) */
const AGENT_ICONS: IconType[] = [
  GiRobotGolem,
  GiMagicSwirl,
  GiSwordsPower,
  GiOwl,
  GiChessKnight,
  GiLightningBow,
  GiCog,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTimestamp(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateStamp(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Map an XP reason string to a contextual game icon */
function getReasonIcon(reason: string): IconType {
  const r = reason.toLowerCase();
  if (r.includes("store") || r.includes("memory") || r.includes("memorize")) return GiBrain;
  if (r.includes("recall") || r.includes("search") || r.includes("retrieve")) return GiMagnifyingGlass;
  if (r.includes("sync")) return GiCrystalBall;
  if (r.includes("badge") || r.includes("achievement")) return GiTrophy;
  if (r.includes("edge") || r.includes("connection") || r.includes("link")) return GiSpiderWeb;
  return GiScrollUnfurled;
}

/** Map a badge name to its game icon */
function getBadgeIcon(badge: string): IconType {
  switch (badge) {
    case "First Memory":    return GiBrain;
    case "100 Syncs":       return GiCrystalBall;
    case "Graph Architect": return GiSpiderWeb;
    case "Curator":         return GiBookCover;
    case "Early Adopter":   return GiLaurelCrown;
    default:                return GiTrophy;
  }
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Shimmer({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded bg-[#0d1e2e] ${className}`} />
  );
}

// ---------------------------------------------------------------------------
// Party Banner
// ---------------------------------------------------------------------------

interface PartyMemberProps {
  icon: IconType;
  name: string;
  count: number;
  isOperator?: boolean;
}

function PartyMember({ icon: Icon, name, count, isOperator = false }: PartyMemberProps) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-3 min-w-[90px]">
      <div
        className={`flex items-center justify-center rounded-full border ${
          isOperator
            ? "w-16 h-16 border-[#D4AF37]/60 bg-[#D4AF37]/10 shadow-[0_0_20px_rgba(212,175,55,0.25)]"
            : "w-11 h-11 border-[#00F0FF]/30 bg-[#00F0FF]/5"
        }`}
      >
        <Icon
          size={isOperator ? 36 : 22}
          className={isOperator ? "text-[#D4AF37]" : "text-[#00F0FF]"}
        />
      </div>
      <span
        className={`text-xs font-bold tracking-wider truncate max-w-[80px] text-center ${
          isOperator ? "text-[#D4AF37]" : "text-[#ededed]"
        }`}
      >
        {name}
      </span>
      <span className="text-[10px] text-[#888]">
        {isOperator ? "operator" : `${count} node${count !== 1 ? "s" : ""}`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline Event Card
// ---------------------------------------------------------------------------

interface TimelineEventProps {
  reason: string;
  xp: number;
  createdAt: string;
  index: number;
  isLast: boolean;
}

function TimelineEvent({ reason, xp, createdAt, index, isLast }: TimelineEventProps) {
  const Icon = getReasonIcon(reason);
  const isLeft = index % 2 === 0;

  return (
    <div className="relative flex items-start gap-0">
      {/* Left column: timestamp (desktop) */}
      <div className={`hidden md:flex w-[140px] flex-shrink-0 flex-col items-end pr-6 pt-1 ${isLeft ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <span className="text-xs text-[#D4AF37] font-bold">{formatTimestamp(createdAt)}</span>
        <span className="text-[10px] text-[#555]">{formatDateStamp(createdAt)}</span>
      </div>

      {/* Center spine */}
      <div className="relative flex flex-col items-center flex-shrink-0">
        {/* Vertical line above dot */}
        <div className={`w-px bg-gradient-to-b from-[#D4AF37]/40 to-[#D4AF37]/10 ${index === 0 ? "h-2" : "h-4"}`} />
        {/* Dot */}
        <div className="w-3 h-3 rounded-full border-2 border-[#D4AF37] bg-[#0a1520] shadow-[0_0_8px_rgba(212,175,55,0.5)] z-10 flex-shrink-0" />
        {/* Vertical line below dot */}
        {!isLast && (
          <div className="w-px flex-1 bg-gradient-to-b from-[#D4AF37]/20 to-[#D4AF37]/5 min-h-[48px]" />
        )}
      </div>

      {/* Right column: event card */}
      <div className={`hidden md:flex w-[140px] flex-shrink-0 flex-col items-start pl-6 pt-1 ${!isLeft ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <span className="text-xs text-[#D4AF37] font-bold">{formatTimestamp(createdAt)}</span>
        <span className="text-[10px] text-[#555]">{formatDateStamp(createdAt)}</span>
      </div>

      {/* Mobile timestamp (always visible) */}
      <div className="flex md:hidden flex-col items-start pl-4 pt-1 w-full">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] text-[#D4AF37]">{formatTimestamp(createdAt)}</span>
          <span className="text-[10px] text-[#555]">{formatDateStamp(createdAt)}</span>
        </div>
      </div>

      {/* Card — floated left or right on desktop */}
      <div className={`md:absolute md:top-0 ${isLeft ? "md:right-[calc(50%+24px)]" : "md:left-[calc(50%+24px)]"} md:w-[calc(50%-60px)] hidden md:block`}>
        <GoldCard padding="p-3" className="rounded-md">
          <div className="flex items-start gap-3">
            <Icon size={20} className="text-[#D4AF37] flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[#ededed] leading-snug truncate">{reason}</p>
              <span className="text-[#D4AF37] font-bold text-sm">+{xp} XP</span>
            </div>
          </div>
        </GoldCard>
      </div>
    </div>
  );
}

/** Mobile-only simple list item for timeline events */
function TimelineEventMobile({ reason, xp, createdAt }: Omit<TimelineEventProps, "index" | "isLast">) {
  const Icon = getReasonIcon(reason);
  return (
    <div className="flex items-center gap-3 py-2 border-b border-[#D4AF37]/10 last:border-0">
      <Icon size={18} className="text-[#D4AF37] flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[#ededed] truncate">{reason}</p>
        <span className="text-[10px] text-[#888]">{relativeTime(createdAt)}</span>
      </div>
      <span className="text-[#D4AF37] font-bold text-xs flex-shrink-0">+{xp} XP</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function GamificationPage() {
  const gamification = useGamification();
  const { data, isLoading } = gamification;

  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [dashLoading, setDashLoading] = useState(true);

  useEffect(() => {
    apiFetch<DashboardData>("/api/v1/admin/dashboard")
      .then(setDashboardData)
      .catch(() => setDashboardData(null))
      .finally(() => setDashLoading(false));
  }, []);

  const namespaceCounts: NamespaceCount[] = dashboardData?.namespace_counts ?? [];

  return (
    <div className="font-mono text-[#ededed]">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-8">
        <TbFlame size={28} className="text-[#D4AF37]" />
        <h1 className="text-2xl font-bold tracking-wide">Adventure Log</h1>
      </div>

      {/* ── Hero Card (level + XP bar) ──────────────────────────────── */}
      <GoldCard className="rounded-lg mb-6">
        {isLoading ? (
          <div className="flex flex-col gap-4">
            <Shimmer className="h-8 w-48" />
            <Shimmer className="h-4 w-32" />
            <Shimmer className="h-4 w-full" />
            <Shimmer className="h-3 w-24" />
          </div>
        ) : data ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold tracking-widest text-[#D4AF37]">
                {data.level_name.toUpperCase()}
              </span>
              <span className="text-[#888] text-lg">Level {data.level}</span>
            </div>
            <div>
              <div className="flex justify-between text-xs text-[#888] mb-2">
                <span>{data.total_xp} XP</span>
                <span>{data.next_level_xp} XP</span>
              </div>
              <div className="h-3 bg-[#050a0f] rounded-full overflow-hidden border border-[#D4AF37]/10">
                <div
                  className="h-full bg-[#D4AF37] rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(data.progress_pct, 100)}%` }}
                />
              </div>
              <div className="text-right text-xs text-[#888] mt-1">
                {data.progress_pct.toFixed(1)}% to next level
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[#888]">No profile data available yet.</p>
        )}
      </GoldCard>

      {/* ── Party Banner ────────────────────────────────────────────── */}
      <GoldCard className="rounded-lg mb-8" padding="p-4">
        <p className="text-[10px] text-[#888] tracking-widest uppercase mb-4">Party</p>
        <div className="flex flex-wrap items-start gap-2 justify-start">
          {/* Operator */}
          <PartyMember
            icon={GiCrown}
            name="Operator"
            count={0}
            isOperator
          />

          {/* Divider */}
          <div className="hidden sm:block w-px self-stretch bg-[#D4AF37]/15 mx-2" />

          {/* Agents per namespace */}
          {dashLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-2 px-4 py-3">
                  <Shimmer className="w-11 h-11 rounded-full" />
                  <Shimmer className="h-3 w-16" />
                  <Shimmer className="h-2 w-10" />
                </div>
              ))
            : namespaceCounts.length > 0
            ? namespaceCounts.map(({ namespace, count }, i) => {
                const Icon = AGENT_ICONS[i % AGENT_ICONS.length];
                return (
                  <PartyMember
                    key={namespace}
                    icon={Icon}
                    name={namespace}
                    count={count}
                  />
                );
              })
            : (
              <div className="flex items-center gap-2 px-4 py-3 text-[#555] text-xs">
                <GiRobotGolem size={20} className="text-[#333]" />
                <span>No agents found yet</span>
              </div>
            )
          }
        </div>
      </GoldCard>

      {/* ── Quest Log (Timeline) ─────────────────────────────────────── */}
      <section className="mb-10">
        <p className="text-[10px] text-[#888] tracking-widest uppercase mb-6">Quest Log</p>

        {isLoading ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Shimmer key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : data && data.recent_xp.length > 0 ? (
          <>
            {/* Desktop: alternating timeline */}
            <div className="hidden md:block relative">
              {/* Center spine container — events lay out relative to it */}
              <div className="flex flex-col items-center">
                {data.recent_xp.slice(0, 12).map((entry, i) => (
                  <TimelineEvent
                    key={i}
                    reason={entry.reason}
                    xp={entry.xp}
                    createdAt={entry.created_at}
                    index={i}
                    isLast={i === Math.min(data.recent_xp.length, 12) - 1}
                  />
                ))}
              </div>
            </div>

            {/* Mobile: simple list in GoldCard */}
            <div className="md:hidden">
              <GoldCard className="rounded-lg" padding="p-4">
                {data.recent_xp.slice(0, 10).map((entry, i) => (
                  <TimelineEventMobile
                    key={i}
                    reason={entry.reason}
                    xp={entry.xp}
                    createdAt={entry.created_at}
                  />
                ))}
              </GoldCard>
            </div>
          </>
        ) : (
          <GoldCard className="rounded-lg" padding="p-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <GiScrollUnfurled size={36} className="text-[#333]" />
              <p className="text-[#888] text-sm">No quests completed yet. Start adding memories!</p>
            </div>
          </GoldCard>
        )}
      </section>

      {/* ── Badges ─────────────────────────────────────────────────── */}
      <section>
        <p className="text-[10px] text-[#888] tracking-widest uppercase mb-4">Achievements</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {isLoading
            ? ALL_BADGES.map((b) => (
                <Shimmer key={b} className="h-28 rounded-lg" />
              ))
            : ALL_BADGES.map((badge) => {
                const earned = data?.badges.includes(badge) ?? false;
                const Icon = getBadgeIcon(badge);
                return (
                  <GoldCard
                    key={badge}
                    className={`rounded-lg transition-all duration-300 ${
                      earned
                        ? "shadow-[0_0_20px_rgba(212,175,55,0.15)]"
                        : "opacity-40 grayscale"
                    }`}
                    padding="p-4"
                  >
                    <div className="flex flex-col items-center justify-center gap-2 text-center h-full min-h-[80px]">
                      <Icon
                        size={28}
                        className={earned ? "text-[#D4AF37]" : "text-[#444]"}
                      />
                      <span
                        className={`text-xs font-medium leading-tight ${
                          earned ? "text-[#ededed]" : "text-[#555]"
                        }`}
                      >
                        {badge}
                      </span>
                      {earned && (
                        <span className="text-[9px] text-[#D4AF37]/70 tracking-widest uppercase">
                          Earned
                        </span>
                      )}
                    </div>
                  </GoldCard>
                );
              })}
        </div>
      </section>
    </div>
  );
}
