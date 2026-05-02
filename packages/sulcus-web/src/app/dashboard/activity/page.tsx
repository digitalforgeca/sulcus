'use client';

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TbHistory,
  TbPlus,
  TbTrash,
  TbPin,
  TbPencil,
  TbRefresh,
  TbCreditCard,
  TbLogin,
  TbActivity,
  TbX,
} from "react-icons/tb";
import { ActivityItem } from "@/hooks/useSulcusApi";
import { apiFetch } from "@/lib/api";

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

function actionColor(action: string): string {
  if (action.startsWith("memory.")) return "#00F0FF";
  if (action === "sync") return "#D4AF37";
  if (action.startsWith("billing.")) return "#22c55e";
  if (action === "login") return "#888";
  return "#888";
}

function ActionIcon({ action }: { action: string }) {
  const size = 16;
  if (action === "memory.add") return <TbPlus size={size} />;
  if (action === "memory.delete") return <TbTrash size={size} />;
  if (action === "memory.pin") return <TbPin size={size} />;
  if (action === "memory.patch") return <TbPencil size={size} />;
  if (action === "sync") return <TbRefresh size={size} />;
  if (action.startsWith("billing.")) return <TbCreditCard size={size} />;
  if (action === "login") return <TbLogin size={size} />;
  return <TbActivity size={size} />;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 p-4 border-b border-[#222] animate-pulse">
      <div className="w-8 h-8 rounded-md bg-[#0a1520]" />
      <div className="flex-1 flex flex-col gap-2">
        <div className="h-3 w-40 rounded bg-[#0a1520]" />
        <div className="h-3 w-64 rounded bg-[#0a1520]" />
      </div>
      <div className="h-3 w-16 rounded bg-[#0a1520]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface ActivityResponse {
  items: ActivityItem[];
  next_cursor: string | null;
}

export default function ActivityPage() {
  const [actor, setActor] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [before, setBefore] = useState("");

  // Applied filters (only update on "Apply")
  const [applied, setApplied] = useState<{
    actor: string;
    action: string;
    before: string;
  }>({ actor: "", action: "", before: "" });

  // Accumulated items across pages
  const [pages, setPages] = useState<ActivityItem[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  // Build query string
  const params = new URLSearchParams();
  params.set("limit", "50");
  if (applied.actor) params.set("actor", applied.actor);
  if (applied.action) params.set("action", applied.action);
  if (cursor) params.set("before", cursor);
  else if (applied.before) params.set("before", applied.before);
  const qs = params.toString();

  const { data, isLoading, isFetching } = useQuery<ActivityResponse>({
    queryKey: ["sulcus", "activity-page", qs, fetchTrigger],
    queryFn: () => apiFetch(`/api/v1/activity?${qs}`),
    staleTime: 30_000,
  });

  // Accumulate pages (only on new data)
  useEffect(() => {
    if (data && !isFetching) {
      setPages((prev) => {
        // Avoid duplicates by checking if we already have this page
        const allIds = new Set(prev.flat().map((i) => i.id));
        const newItems = data.items.filter((i) => !allIds.has(i.id));
        if (newItems.length === 0) return prev;
        return [...prev, newItems];
      });
    }
  }, [data, isFetching]);

  const applyFilters = () => {
    setApplied({ actor, action: actionFilter, before });
    setCursor(null);
    setPages([]);
    setFetchTrigger((n) => n + 1);
  };

  const clearFilters = () => {
    setActor("");
    setActionFilter("");
    setBefore("");
    setApplied({ actor: "", action: "", before: "" });
    setCursor(null);
    setPages([]);
    setFetchTrigger((n) => n + 1);
  };

  const loadMore = () => {
    if (data?.next_cursor) {
      setCursor(data.next_cursor);
      setFetchTrigger((n) => n + 1);
    }
  };

  const displayItems = pages.flat();

  return (
    <div className="font-mono text-[#ededed]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <TbHistory size={28} className="text-[#D4AF37]" />
        <h1 className="text-2xl font-bold tracking-wide">Activity Log</h1>
      </div>

      {/* Filter Bar */}
      <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <label className="text-xs text-[#888]">Actor</label>
          <input
            type="text"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="Filter by actor…"
            className="bg-[#050a0f] border border-[#222] rounded px-3 py-2 text-sm text-[#ededed] placeholder-[#555] focus:border-[#D4AF37]/40 focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <label className="text-xs text-[#888]">Action prefix</label>
          <input
            type="text"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="e.g. memory"
            className="bg-[#050a0f] border border-[#222] rounded px-3 py-2 text-sm text-[#ededed] placeholder-[#555] focus:border-[#D4AF37]/40 focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
          <label className="text-xs text-[#888]">Before date</label>
          <input
            type="datetime-local"
            value={before}
            onChange={(e) => setBefore(e.target.value)}
            className="bg-[#050a0f] border border-[#222] rounded px-3 py-2 text-sm text-[#ededed] focus:border-[#D4AF37]/40 focus:outline-none"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={applyFilters}
            className="px-4 py-2 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded text-[#D4AF37] text-sm hover:bg-[#D4AF37]/20 transition-colors"
          >
            Apply
          </button>
          <button
            onClick={clearFilters}
            className="p-2 text-[#888] hover:text-[#ededed] transition-colors border border-[#222] rounded"
            title="Clear filters"
          >
            <TbX size={16} />
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-[#0a1520] border border-[#D4AF37]/10 rounded-lg overflow-hidden">
        {isLoading && displayItems.length === 0 && (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        )}

        {!isLoading && displayItems.length === 0 && (
          <div className="p-12 text-center text-[#888]">
            <TbHistory size={48} className="mx-auto mb-4 opacity-30" />
            <p>No activity yet. Start syncing memories to see the log here.</p>
          </div>
        )}

        {displayItems.map((item) => {
          const color = actionColor(item.action);
          const label = item.target_label
            ? item.target_label.length > 60
              ? item.target_label.slice(0, 57) + "…"
              : item.target_label
            : null;

          return (
            <div
              key={item.id}
              className="flex items-center gap-4 p-4 border-b border-[#222] last:border-b-0 hover:bg-[#050a0f]/50 transition-colors"
            >
              {/* Action badge */}
              <div
                className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
                style={{ color, background: `${color}15`, border: `1px solid ${color}30` }}
              >
                <ActionIcon action={item.action} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm">{item.actor}</span>
                  <span className="text-xs" style={{ color }}>{item.action}</span>
                  {label && (
                    <span className="text-xs text-[#888] truncate">{label}</span>
                  )}
                </div>
              </div>

              {/* Timestamp */}
              <div
                className="text-xs text-[#888] flex-shrink-0 cursor-default"
                title={new Date(item.created_at).toLocaleString()}
              >
                {relativeTime(item.created_at)}
              </div>
            </div>
          );
        })}

        {/* Load More */}
        {data?.next_cursor && !isFetching && (
          <div className="p-4 text-center border-t border-[#222]">
            <button
              onClick={loadMore}
              className="px-6 py-2 border border-[#D4AF37]/30 rounded text-[#D4AF37] text-sm hover:bg-[#D4AF37]/10 transition-colors"
            >
              Load more
            </button>
          </div>
        )}

        {isFetching && displayItems.length > 0 && (
          <div className="p-4 text-center border-t border-[#222] text-[#888] text-xs animate-pulse">
            Loading more…
          </div>
        )}
      </div>
    </div>
  );
}
