"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

import { SERVER_URL, authHeaders, apiFetch } from "@/lib/api";

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

// Sulcus product tiers — filter out non-Sulcus products
const SULCUS_TIERS = ["cortex", "enterprise"];

function BillingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "canceled">("idle");
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [products, setProducts] = useState<StripeProduct[]>([]);
  const [prices, setPrices] = useState<StripePrice[]>([]);
  const [fetchingProducts, setFetchingProducts] = useState(true);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [loadingTier, setLoadingTier] = useState(true);
  const [currentTier, setCurrentTier] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("success")) setStatus("success");
    if (searchParams.get("canceled")) setStatus("canceled");

    async function loadOrg() {
      try {
        const data = await apiFetch<{ plan_tier?: string }>("/api/v1/org");
        // Normalise legacy tier names from old JIT-provisioned rows:
        const raw: string = data.plan_tier || "free";
        const tier =
          raw === "starter" || raw === "pro"
            ? "free"
            : raw === "team"
              ? "cortex"
              : raw;
        setCurrentTier(tier);
      } catch (err) {
        console.error("Failed to fetch org for billing tier", err);
        setCurrentTier("free"); // only fall back after confirmed failure
      } finally {
        setLoadingTier(false);
      }
    }
    loadOrg();

    async function loadUsage() {
      try {
        const hdrs = await authHeaders();
        const res = await fetch(`${SERVER_URL}/api/v1/admin/usage`, {
          headers: hdrs,
        });
        if (res.ok) {
          const data: UsageData[] = await res.json();
          if (data.length > 0) setUsage(data[0]);
        }
      } catch (err) {
        console.error("Failed to fetch usage", err);
      } finally {
        setLoadingUsage(false);
      }
    }

    async function loadProducts() {
      try {
        const res = await fetch(`${SERVER_URL}/api/v1/billing/products`);
        if (res.ok) {
          const data = await res.json();
          const allProducts: StripeProduct[] = data.products?.data || [];
          const allPrices: StripePrice[] = data.prices?.data || [];
          // Filter to Sulcus-specific products
          const sulcusProducts = allProducts.filter(
            (p) => p.metadata?.tier && SULCUS_TIERS.includes(p.metadata.tier),
          );
          setProducts(sulcusProducts);
          setPrices(allPrices);
        }
      } catch (err) {
        console.error("Failed to fetch products", err);
      } finally {
        setFetchingProducts(false);
      }
    }

    loadUsage();
    loadProducts();
  }, [searchParams]);

  const handleUpgrade = (
    priceId: string,
    planName: string,
    amount?: string,
  ) => {
    const params = new URLSearchParams({ price: priceId, plan: planName });
    if (amount) params.set("amount", amount);
    router.push(`/dashboard/billing/checkout?${params.toString()}`);
  };

  const handleManage = async () => {
    setLoading(true);
    try {
      const hdrs = await authHeaders();
      const res = await fetch(
        `${SERVER_URL}/api/v1/billing/create-portal-session`,
        {
          method: "POST",
          headers: hdrs,
        },
      );

      if (!res.ok) throw new Error("Failed to create portal session");
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch (err) {
      alert("You may not have an active subscription yet.");
      setLoading(false);
    }
  };

  // Quota limits
  const FREE_LIMITS = { sync_requests: 10000, nodes: 1000 };
  const syncPct = usage
    ? Math.min((usage.sync_requests / FREE_LIMITS.sync_requests) * 100, 100)
    : 0;
  const nodesPct = usage
    ? Math.min((usage.nodes_added / FREE_LIMITS.nodes) * 100, 100)
    : 0;

  // Sort products: cortex first, then enterprise
  const sortedProducts = [...products].sort((a, b) => {
    const order = ["cortex", "enterprise"];
    return (
      order.indexOf(a.metadata?.tier || "") -
      order.indexOf(b.metadata?.tier || "")
    );
  });

  return (
    <div className="max-w-4xl font-sans">
      <h1 className="text-3xl font-bold mb-8 tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
        <div className="w-2 h-2 bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"></div>
        Subscription & Quota
      </h1>

      {status === "success" && (
        <div className="bg-[#0a1520] border border-[#00F0FF]/50 text-[#00F0FF] p-4 font-mono tracking-wider flex justify-between items-center mb-8">
          <span>Upgrade successful! Your tier is being provisioned.</span>
          <button
            onClick={() => setStatus("idle")}
            className="hover:text-white"
          >
            &times;
          </button>
        </div>
      )}

      {status === "canceled" && (
        <div className="bg-red-950/30 border border-red-500/50 text-red-400 p-4 font-mono tracking-wider flex justify-between items-center mb-8">
          <span>Checkout canceled. No changes were made.</span>
          <button
            onClick={() => setStatus("idle")}
            className="hover:text-white"
          >
            &times;
          </button>
        </div>
      )}

      {/* Current Plan */}
      <div className="bg-[#0a1520] p-8 rounded-lg border border-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.05)] relative mb-10">
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#D4AF37]"></div>
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#D4AF37]"></div>
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>

        <h2 className="text-xl font-bold mb-2 text-white uppercase tracking-widest">
          Current Plan:{" "}
          {loadingTier || currentTier === null ? (
            <span className="animate-pulse text-[#555]">Loading…</span>
          ) : currentTier === "free" ? (
            "Open (Free)"
          ) : currentTier === "cortex" ? (
            "✨ Cortex"
          ) : currentTier === "enterprise" ? (
            "👑 Enterprise"
          ) : (
            currentTier
          )}
        </h2>
        <p className="text-[#888] mb-6 text-sm">
          {currentTier === null || loadingTier
            ? ""
            : currentTier === "free"
              ? "Local sidecar with cloud sync. Upgrade for team features and higher limits."
              : currentTier === "cortex"
                ? "Team plan with 100K sync/mo, 5 agents, remote MCP, and priority support."
                : "Unlimited everything. Dedicated support and custom retention."}
        </p>

        {loadingUsage ? (
          <div className="text-[#888] animate-pulse font-mono text-sm">
            Loading usage…
          </div>
        ) : usage ? (
          <div className="space-y-4 max-w-lg">
            <div className="bg-[#111820] p-4 border border-[#D4AF37]/20">
              <div className="flex justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-[#888]">
                  Sync Requests (this month)
                </span>
                <span className="text-xs font-bold text-[#D4AF37]">
                  {usage.sync_requests.toLocaleString()} /{" "}
                  {FREE_LIMITS.sync_requests.toLocaleString()}
                </span>
              </div>
              <div className="w-full bg-black h-1">
                <div
                  className={`h-1 transition-all duration-500 ${syncPct > 80 ? "bg-[#D4AF37] shadow-[0_0_8px_#D4AF37]" : "bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"}`}
                  style={{ width: `${syncPct}%` }}
                ></div>
              </div>
            </div>

            <div className="bg-[#111820] p-4 border border-[#D4AF37]/20">
              <div className="flex justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-[#888]">
                  Nodes Added (this month)
                </span>
                <span className="text-xs font-bold text-[#D4AF37]">
                  {usage.nodes_added.toLocaleString()} /{" "}
                  {FREE_LIMITS.nodes.toLocaleString()}
                </span>
              </div>
              <div className="w-full bg-black h-1">
                <div
                  className={`h-1 transition-all duration-500 ${nodesPct > 80 ? "bg-[#D4AF37] shadow-[0_0_8px_#D4AF37]" : "bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"}`}
                  style={{ width: `${nodesPct}%` }}
                ></div>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="bg-[#111820] p-3 border border-[#D4AF37]/10 flex-1">
                <div className="text-xs uppercase tracking-wider text-[#888] mb-1">
                  Avg Latency
                </div>
                <div className="text-lg font-mono text-[#00F0FF]">
                  {usage.avg_latency_ms.toFixed(1)}ms
                </div>
              </div>
              <div className="bg-[#111820] p-3 border border-[#D4AF37]/10 flex-1">
                <div className="text-xs uppercase tracking-wider text-[#888] mb-1">
                  Peak Latency
                </div>
                <div className="text-lg font-mono text-[#00F0FF]">
                  {usage.max_latency_ms.toFixed(1)}ms
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[#555] font-mono text-sm">
            No usage data yet.
          </div>
        )}
      </div>

      {/* Plans */}
      <h2 className="text-2xl font-bold mb-6 tracking-widest text-white uppercase">
        Plans
      </h2>

      {fetchingProducts ? (
        <div className="text-[#888] animate-pulse font-mono text-sm uppercase">
          Loading plans from Stripe…
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {/* Free tier (always shown) */}
          <div
            className={`bg-[#0a1520] p-6 border relative flex flex-col ${currentTier === "free" ? "border-[#00F0FF]/30" : "border-[#333]"}`}
          >
            <div
              className={`absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent ${currentTier === "free" ? "via-[#00F0FF]" : "via-[#333]"} to-transparent`}
            ></div>
            {currentTier === "free" && (
              <div className="text-xs uppercase tracking-widest text-[#00F0FF] mb-2">
                Current
              </div>
            )}
            <h3 className="text-lg font-bold text-white tracking-widest uppercase mb-1">
              Open
            </h3>
            <div className="text-2xl font-mono text-white mb-3">Free</div>
            <ul className="text-[#888] text-sm space-y-2 flex-1 mb-4">
              <li className="flex items-start gap-2">
                <span className="text-[#00F0FF]">✓</span> Local embedded PG
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#00F0FF]">✓</span> Cloud sync (10K
                req/mo)
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#00F0FF]">✓</span> 1 agent
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#00F0FF]">✓</span> MCP tools
              </li>
            </ul>
            <div
              className={`w-full border px-4 py-2 text-center text-sm tracking-widest uppercase ${currentTier === "free" ? "border-[#00F0FF]/30 text-[#00F0FF]" : "border-[#333] text-[#555]"}`}
            >
              {currentTier === "free" ? "Active" : "Free Tier"}
            </div>
          </div>

          {/* Dynamic Stripe products */}
          {sortedProducts.map((product) => {
            const price = prices.find((p) => p.product === product.id);
            const priceStr = price
              ? `$${(price.unit_amount / 100).toFixed(0)}`
              : "Custom";
            const interval = price?.recurring?.interval
              ? `/${price.recurring.interval}`
              : "";
            const isCortex = product.metadata?.tier === "cortex";
            const meta = product.metadata || {};

            // Build feature list from metadata
            const featureItems: string[] = [];
            if (meta.max_sync_requests)
              featureItems.push(
                meta.max_sync_requests === "unlimited"
                  ? "Unlimited sync"
                  : `${Number(meta.max_sync_requests).toLocaleString()} sync/mo`,
              );
            if (meta.max_agents)
              featureItems.push(
                meta.max_agents === "unlimited"
                  ? "Unlimited agents"
                  : `${meta.max_agents} agents`,
              );
            if (meta.max_nodes)
              featureItems.push(
                meta.max_nodes === "unlimited"
                  ? "Unlimited nodes"
                  : `${Number(meta.max_nodes).toLocaleString()} nodes`,
              );
            if (meta.features) {
              meta.features.split(",").forEach((f: string) => {
                const label = f
                  .trim()
                  .replace(/_/g, " ")
                  .replace(/\b\w/g, (c) => c.toUpperCase());
                featureItems.push(label);
              });
            }

            const isActive = meta.tier === currentTier;

            return (
              <div
                key={product.id}
                className={`bg-[#0a1520] p-6 border relative flex flex-col ${isActive ? "border-[#00F0FF]/50" : isCortex ? "border-[#D4AF37]/40" : "border-[#333]"}`}
              >
                <div
                  className={`absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent ${isActive ? "via-[#00F0FF]" : isCortex ? "via-[#D4AF37]" : "via-[#555]"} to-transparent`}
                ></div>
                {isActive ? (
                  <div className="text-xs uppercase tracking-widest text-[#00F0FF] mb-2">
                    Current Plan
                  </div>
                ) : isCortex ? (
                  <div className="text-xs uppercase tracking-widest text-[#D4AF37] mb-2">
                    Recommended
                  </div>
                ) : (
                  <div className="text-xs uppercase tracking-widest text-[#555] mb-2">
                    Teams
                  </div>
                )}
                <h3
                  className={`text-lg font-bold tracking-widest uppercase mb-1 ${isCortex ? "text-[#D4AF37]" : "text-white"}`}
                >
                  {product.name.replace("Sulcus ", "")}
                </h3>
                <div className="text-2xl font-mono text-white mb-3">
                  {priceStr}
                  <span className="text-sm text-[#888]">{interval}</span>
                </div>
                <ul className="text-[#888] text-sm space-y-2 flex-1 mb-4">
                  {featureItems.map((feat, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span
                        className={isCortex ? "text-[#D4AF37]" : "text-[#555]"}
                      >
                        ✓
                      </span>
                      {feat}
                    </li>
                  ))}
                </ul>

                {isActive ? (
                  <div className="w-full border border-[#00F0FF]/30 text-[#00F0FF] px-4 py-2 text-center text-sm tracking-widest uppercase">
                    Active
                  </div>
                ) : price ? (
                  <button
                    onClick={() =>
                      handleUpgrade(price.id, product.name, priceStr)
                    }
                    disabled={loading}
                    className={`w-full px-4 py-2 text-sm font-bold tracking-widest uppercase transition-all disabled:opacity-50 ${
                      isCortex
                        ? "bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-[#050a0f] hover:brightness-110"
                        : "border border-[#555] text-[#888] hover:border-[#D4AF37] hover:text-[#D4AF37]"
                    }`}
                  >
                    {loading ? "Processing…" : "Subscribe"}
                  </button>
                ) : (
                  <div className="w-full border border-[#333] text-[#555] px-4 py-2 text-center text-sm tracking-widest uppercase">
                    Contact Us
                  </div>
                )}
              </div>
            );
          })}

          {/* Fallback if no products loaded */}
          {sortedProducts.length === 0 && (
            <>
              <div className="bg-[#0a1520] p-6 border border-[#D4AF37]/40 relative flex flex-col">
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent"></div>
                <div className="text-xs uppercase tracking-widest text-[#D4AF37] mb-2">
                  Recommended
                </div>
                <h3 className="text-lg font-bold text-[#D4AF37] tracking-widest uppercase mb-1">
                  Cortex
                </h3>
                <div className="text-2xl font-mono text-white mb-3">
                  $29<span className="text-sm text-[#888]">/mo</span>
                </div>
                <ul className="text-[#888] text-sm space-y-2 flex-1 mb-4">
                  <li className="flex items-start gap-2">
                    <span className="text-[#D4AF37]">✓</span> 100K sync/mo
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#D4AF37]">✓</span> 5 agents
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#D4AF37]">✓</span> Remote MCP
                  </li>
                </ul>
                <div className="w-full border border-[#D4AF37]/50 text-[#D4AF37] px-4 py-2 text-center text-sm tracking-widest uppercase opacity-50">
                  Loading…
                </div>
              </div>
              <div className="bg-[#0a1520] p-6 border border-[#333] relative flex flex-col">
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#555] to-transparent"></div>
                <div className="text-xs uppercase tracking-widest text-[#555] mb-2">
                  Teams
                </div>
                <h3 className="text-lg font-bold text-white tracking-widest uppercase mb-1">
                  Enterprise
                </h3>
                <div className="text-2xl font-mono text-white mb-3">
                  $149<span className="text-sm text-[#888]">/mo</span>
                </div>
                <ul className="text-[#888] text-sm space-y-2 flex-1 mb-4">
                  <li className="flex items-start gap-2">
                    <span className="text-[#555]">✓</span> Unlimited sync
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#555]">✓</span> SSO / SAML
                  </li>
                </ul>
                <div className="w-full border border-[#333] text-[#555] px-4 py-2 text-center text-sm tracking-widest uppercase opacity-50">
                  Loading…
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Manage subscription */}
      <div className="bg-[#0a1520] p-6 border border-[#00F0FF]/20 relative">
        <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#00F0FF] to-transparent"></div>
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-1">
              Manage Subscription
            </h3>
            <p className="text-xs text-[#555]">
              Update billing, download invoices, or cancel via the Stripe
              portal.
            </p>
          </div>
          <button
            onClick={handleManage}
            disabled={loading}
            className="text-xs text-[#00F0FF] border border-[#00F0FF]/30 px-4 py-2 hover:bg-[#00F0FF]/10 transition-colors uppercase tracking-widest disabled:opacity-50"
          >
            {loading ? "Processing…" : "Customer Portal"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="text-[#888] font-mono animate-pulse p-8">
          Loading billing…
        </div>
      }
    >
      <BillingContent />
    </Suspense>
  );
}
