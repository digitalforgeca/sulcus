"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/providers";
import Script from "next/script";

const TURNSTILE_SITE_KEY = "0x4AAAAAACwfFiKTStKLuINQ";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { loginDirect, loading, user } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [turnstileVerified, setTurnstileVerified] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const callbackUrl = params.get("callbackUrl") || "/dashboard";
  const inviteParam = params.get("invite");

  // If invite token present, redirect to register page
  useEffect(() => {
    if (inviteParam) {
      router.replace(`/register?invite=${encodeURIComponent(inviteParam)}`);
    }
  }, [inviteParam, router]);

  // If already authenticated, redirect
  useEffect(() => {
    if (!loading && user) {
      router.replace(callbackUrl);
    }
  }, [user, loading, router, callbackUrl]);

  const renderTurnstile = useCallback(() => {
    if (!turnstileRef.current || !(window as any).turnstile) return;
    if (widgetIdRef.current !== null) {
      try { (window as any).turnstile.remove(widgetIdRef.current); } catch {}
      widgetIdRef.current = null;
    }
    widgetIdRef.current = (window as any).turnstile.render(turnstileRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      callback: () => setTurnstileVerified(true),
      "expired-callback": () => setTurnstileVerified(false),
      "error-callback": () => setTurnstileVerified(false),
    });
  }, []);

  useEffect(() => {
    setTurnstileVerified(false);
    // Poll for Cloudflare turnstile to be available (script loads async)
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds total
    const poll = setInterval(() => {
      attempts++;
      if ((window as any).turnstile && turnstileRef.current) {
        clearInterval(poll);
        renderTurnstile();
      } else if (attempts >= maxAttempts) {
        clearInterval(poll);
        // Turnstile failed to load — allow login without it
        setTurnstileVerified(true);
      }
    }, 100);
    return () => clearInterval(poll);
  }, [renderTurnstile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!turnstileVerified || !username.trim() || !password) return;

    setError(null);
    setIsLoading(true);

    try {
      const result = await loginDirect(username.trim(), password);
      if (result.success) {
        router.replace(callbackUrl);
      } else {
        setError(result.error || "Invalid credentials");
        setIsLoading(false);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setIsLoading(false);
    }
  };

  const canSubmit = turnstileVerified && username.trim() && password && !isLoading;

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={renderTurnstile}
        strategy="afterInteractive"
      />
      <div className="min-h-screen bg-[#050a0f] text-[#ededed] font-mono flex items-center justify-center relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.06] z-0"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='100' viewBox='0 0 60 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cg stroke='%2300F0FF' stroke-width='1' fill='none' fill-rule='evenodd'%3E%3Cpath d='M30 0l30 16.5v33L30 66 0 49.5v-33L30 0zm0 100l30-16.5v-33L30 34 0 50.5v33L30 100z'/%3E%3C/g%3E%3C/svg%3E")`,
            backgroundSize: "60px 100px",
          }}
        />

        <div className="max-w-md w-full mx-4 relative z-10">
          <div className="text-center mb-8">
            <a href="/" className="inline-flex items-center gap-2">
              <div className="w-3 h-3 bg-[#00F0FF] rounded-sm shadow-[0_0_8px_#00F0FF]"></div>
              <span className="text-2xl font-bold tracking-widest text-[#D4AF37] uppercase">
                SULCUS
              </span>
            </a>
          </div>

          <div className="border border-[#D4AF37]/30 p-8 bg-[#0a1520]/50 relative">
            <div className="absolute -top-3 -left-3 w-6 h-6 border-t-2 border-l-2 border-[#D4AF37]"></div>
            <div className="absolute -bottom-3 -right-3 w-6 h-6 border-b-2 border-r-2 border-[#D4AF37]"></div>

            <div className="text-center mb-8">
              <div className="text-[#00F0FF] text-xs tracking-[0.5em] uppercase mb-4">
                Authentication Required
              </div>
              <h1 className="text-xl font-bold text-white uppercase tracking-widest">
                Sign In
              </h1>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[#888] text-xs uppercase tracking-widest mb-2">
                  Username or Email
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  className="w-full bg-[#0a1520] border border-[#D4AF37]/20 text-[#ededed] px-4 py-3 text-sm tracking-wide font-mono focus:outline-none focus:border-[#D4AF37]/60 transition-colors placeholder-[#555]"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="block text-[#888] text-xs uppercase tracking-widest mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full bg-[#0a1520] border border-[#D4AF37]/20 text-[#ededed] px-4 py-3 text-sm tracking-wide font-mono focus:outline-none focus:border-[#D4AF37]/60 transition-colors placeholder-[#555]"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="border border-[#FF6B35]/30 bg-[#FF6B35]/5 px-4 py-2 text-[#FF6B35] text-xs tracking-wide">
                  {error}
                </div>
              )}

              {/* Cloudflare Turnstile */}
              <div ref={turnstileRef} className="flex justify-center my-2" />

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-[#050a0f] px-6 py-4 font-bold hover:brightness-110 transition-all tracking-widest uppercase text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(212,175,55,0.2)]"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-[#050a0f]/30 border-t-[#050a0f] rounded-full animate-spin"></span>
                    Authenticating…
                  </span>
                ) : (
                  "Sign In"
                )}
              </button>
            </form>

            <div className="flex items-center justify-between mt-6">
              <a
                href="/forgot-password"
                className="text-[#888] text-xs uppercase tracking-widest hover:text-[#00F0FF] transition-colors"
              >
                Forgot Password?
              </a>
              <a
                href="/register"
                className="text-[#888] text-xs uppercase tracking-widest hover:text-[#00F0FF] transition-colors"
              >
                Register
              </a>
            </div>

            <p className="text-xs text-[#555] tracking-widest uppercase text-center mt-4">
              Privacy-first · Encrypted Sessions
            </p>
          </div>

          <div className="text-center mt-6">
            <a
              href="/"
              className="text-[#888] text-xs uppercase tracking-widest hover:text-[#00F0FF] transition-colors"
            >
              ← Back to Home
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

export default function LoginClient() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#050a0f] flex items-center justify-center">
          <div className="text-[#D4AF37] tracking-widest uppercase text-sm animate-pulse">
            Initializing...
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
