"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Script from "next/script";
import { SERVER_URL } from "@/lib/api";

const TURNSTILE_SITE_KEY = "0x4AAAAAACwfFiKTStKLuINQ";

export default function ForgotPasswordClient() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileVerified, setTurnstileVerified] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const renderTurnstile = useCallback(() => {
    if (!turnstileRef.current || !(window as any).turnstile) return;
    if (widgetIdRef.current !== null) {
      try {
        (window as any).turnstile.remove(widgetIdRef.current);
      } catch {}
      widgetIdRef.current = null;
    }
    widgetIdRef.current = (window as any).turnstile.render(
      turnstileRef.current,
      {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "dark",
        callback: () => setTurnstileVerified(true),
        "expired-callback": () => setTurnstileVerified(false),
        "error-callback": () => setTurnstileVerified(false),
      }
    );
  }, []);

  useEffect(() => {
    setTurnstileVerified(false);
    let attempts = 0;
    const maxAttempts = 50;
    const poll = setInterval(() => {
      attempts++;
      if ((window as any).turnstile && turnstileRef.current) {
        clearInterval(poll);
        renderTurnstile();
      } else if (attempts >= maxAttempts) {
        clearInterval(poll);
        setTurnstileVerified(true);
      }
    }, 100);
    return () => clearInterval(poll);
  }, [renderTurnstile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!turnstileVerified || !email.trim()) return;

    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch(`${SERVER_URL}/api/v1/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 404) {
          setError("No account found with that email address.");
        } else {
          setError(
            (data as any).message || "Something went wrong. Please try again."
          );
        }
        setIsLoading(false);
        return;
      }

      setSent(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const canSubmit = turnstileVerified && email.trim() && !isLoading;

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

            {sent ? (
              <div className="text-center py-8">
                <div className="text-[#00F0FF] text-4xl mb-4">✓</div>
                <h1 className="text-xl font-bold text-white uppercase tracking-widest mb-4">
                  Check Your Email
                </h1>
                <p className="text-[#888] text-sm leading-relaxed mb-6">
                  If an account with that email exists, we&apos;ve sent a
                  password reset link. The link expires in 15 minutes.
                </p>
                <p className="text-[#555] text-xs mb-6">
                  Didn&apos;t receive it? Check your spam folder or try again.
                </p>
                <button
                  onClick={() => {
                    setSent(false);
                    setEmail("");
                    setTurnstileVerified(false);
                    renderTurnstile();
                  }}
                  className="text-[#00F0FF] text-xs uppercase tracking-widest hover:text-[#D4AF37] transition-colors"
                >
                  Try Again
                </button>
              </div>
            ) : (
              <>
                <div className="text-center mb-8">
                  <div className="text-[#00F0FF] text-xs tracking-[0.5em] uppercase mb-4">
                    Account Recovery
                  </div>
                  <h1 className="text-xl font-bold text-white uppercase tracking-widest">
                    Reset Password
                  </h1>
                  <p className="text-[#888] text-xs mt-3 leading-relaxed">
                    Enter the email address associated with your account and
                    we&apos;ll send a link to reset your password.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-[#888] text-xs uppercase tracking-widest mb-2">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      autoFocus
                      className="w-full bg-[#0a1520] border border-[#D4AF37]/20 text-[#ededed] px-4 py-3 text-sm tracking-wide font-mono focus:outline-none focus:border-[#D4AF37]/60 transition-colors placeholder-[#555]"
                      placeholder="you@example.com"
                    />
                  </div>

                  {error && (
                    <div className="border border-[#FF6B35]/30 bg-[#FF6B35]/5 px-4 py-2 text-[#FF6B35] text-xs tracking-wide">
                      {error}
                    </div>
                  )}

                  <div ref={turnstileRef} className="flex justify-center my-2" />

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="w-full bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-[#050a0f] px-6 py-4 font-bold hover:brightness-110 transition-all tracking-widest uppercase text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                  >
                    {isLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-[#050a0f]/30 border-t-[#050a0f] rounded-full animate-spin"></span>
                        Sending…
                      </span>
                    ) : (
                      "Send Reset Link"
                    )}
                  </button>
                </form>
              </>
            )}

            <a
              href="/login"
              className="block w-full text-[#888] text-xs uppercase tracking-widest mt-6 hover:text-[#00F0FF] transition-colors text-center"
            >
              ← Back to Sign In
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
