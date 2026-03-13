'use client';

import { TbFlame, TbMedal, TbLock } from "react-icons/tb";
import { useSulcusApi } from "@/hooks/useSulcusApi";

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

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Shimmer({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded bg-[#0a1520] ${className}`} />
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function GamificationPage() {
  const { gamification } = useSulcusApi();
  const { data, isLoading } = gamification;

  return (
    <div className="font-mono text-[#ededed]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <TbFlame size={28} className="text-[#D4AF37]" />
        <h1 className="text-2xl font-bold tracking-wide">Memory Profile</h1>
      </div>

      {/* Hero card */}
      <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg p-8 mb-6">
        {isLoading ? (
          <div className="flex flex-col gap-4">
            <Shimmer className="h-8 w-48" />
            <Shimmer className="h-4 w-32" />
            <Shimmer className="h-4 w-full" />
            <Shimmer className="h-3 w-24" />
          </div>
        ) : data ? (
          <div className="flex flex-col gap-4">
            {/* Level name + number */}
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold tracking-widest text-[#D4AF37]">
                {data.level_name.toUpperCase()}
              </span>
              <span className="text-[#888] text-lg">Level {data.level}</span>
            </div>

            {/* XP progress bar */}
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
      </div>

      {/* Two-column layout: Badges + Recent XP */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Badges */}
        <div>
          <h2 className="text-sm font-bold text-[#888] tracking-widest uppercase mb-4">Badges</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {isLoading
              ? ALL_BADGES.map((b) => (
                  <Shimmer key={b} className="h-24" />
                ))
              : ALL_BADGES.map((badge) => {
                  const earned = data?.badges.includes(badge) ?? false;
                  return (
                    <div
                      key={badge}
                      className={`flex flex-col items-center justify-center gap-2 p-4 rounded-lg border text-center transition-colors ${
                        earned
                          ? "bg-[#0a1520] border-[#D4AF37]/40 text-[#D4AF37]"
                          : "bg-[#050a0f] border-[#222] text-[#555]"
                      }`}
                    >
                      {earned ? (
                        <TbMedal size={28} className="text-[#D4AF37]" />
                      ) : (
                        <TbLock size={28} className="text-[#333]" />
                      )}
                      <span className="text-xs font-medium leading-tight">{badge}</span>
                    </div>
                  );
                })}
          </div>
        </div>

        {/* Recent XP Feed */}
        <div>
          <h2 className="text-sm font-bold text-[#888] tracking-widest uppercase mb-4">Recent XP</h2>
          <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3 border-b border-[#222] animate-pulse last:border-b-0">
                  <Shimmer className="h-3 w-16" />
                  <Shimmer className="h-3 flex-1" />
                  <Shimmer className="h-3 w-12" />
                </div>
              ))
            ) : data && data.recent_xp.length > 0 ? (
              data.recent_xp.slice(0, 10).map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-4 p-3 border-b border-[#222] last:border-b-0 hover:bg-[#050a0f]/50 transition-colors"
                >
                  <span className="text-[#D4AF37] font-bold text-sm flex-shrink-0">
                    +{entry.xp} XP
                  </span>
                  <span className="text-[#888] text-xs flex-1 truncate">
                    {entry.reason}
                  </span>
                  <span
                    className="text-xs text-[#555] flex-shrink-0 cursor-default"
                    title={new Date(entry.created_at).toLocaleString()}
                  >
                    {relativeTime(entry.created_at)}
                  </span>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-[#888] text-sm">
                No XP earned yet. Start adding memories!
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
