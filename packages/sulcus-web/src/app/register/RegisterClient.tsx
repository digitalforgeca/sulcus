"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/providers";
import { loginDirect } from "@/lib/auth";
import { SERVER_URL } from "@/lib/api";
import Script from "next/script";

const TURNSTILE_SITE_KEY = "0x4AAAAAACwfFiKTStKLuINQ";

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [turnstileVerified, setTurnstileVerified] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const inviteToken = params.get("invite") || undefined;

  // If already authenticated, redirect
  useEffect(() => {
    if (!loading && user) {
      router.replace("/dashboard");
    }
  }, [user, loading, router]);

  const renderTurnstile = useCallback(() => {
    if (!turnstileRef.current || !(window as unknown as Record<string, unknown>).turnstile) return;
    const ts = (window as unknown as Record<string, unknown>).turnstile as Record<string, (...args: unknown[]) => string>;
    if (widgetIdRef.current !== null) {
      try { ts.remove(widgetIdRef.current); } catch { /* noop */ }
      widgetIdRef.current = null;
    }
    widgetIdRef.current = ts.render(turnstileRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      callback: () => setTurnstileVerified(true),
      "expired-callback": () => setTurnstileVerified(false),
      "error-callback": () => setTurnstileVerified(false),
    });
  }, []);

  useEffect(() => {
    setTurnstileVerified(false);
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      if ((window as unknown as Record<string, unknown>).turnstile && turnstileRef.current) {
        clearInterval(poll);
        renderTurnstile();
      } else if (attempts >= 50) {
        clearInterval(poll);
        setTurnstileVerified(true);
      }
    }, 100);
    return () => clearInterval(poll);
  }, [renderTurnstile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      setError("First and last name required");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Valid email required");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch(`${SERVER_URL}/api/v1/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          password,
          invitation_token: inviteToken,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Registration failed");
        setIsLoading(false);
        return;
      }

      // Auto-login after successful registration
      const loginResult = await loginDirect(email.trim(), password);
      if (loginResult.success) {
        router.replace("/dashboard");
      } else {
        // Registration succeeded but auto-login failed — send to login page
        router.replace("/login");
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setIsLoading(false);
    }
  };

  const canSubmit =
    turnstileVerified &&
    firstName.trim() &&
    lastName.trim() &&
    email.trim() &&
    password &&
    confirmPassword &&
    !isLoading;

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
                {inviteToken ? "Accept Invitation" : "Create Account"}
              </div>
              <h1 className="text-xl font-bold text-white uppercase tracking-widest">
                Register
              </h1>
              {inviteToken && (
                <p className="text-[#888] text-xs mt-2">
                  Complete registration to accept your invitation
                </p>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#888] text-xs uppercase tracking-widest mb-2">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoFocus
                    className="w-full bg-[#0a1520] border border-[#D4AF37]/20 text-[#ededed] px-4 py-3 text-sm tracking-wide font-mono focus:outline-none focus:border-[#D4AF37]/60 transition-colors placeholder-[#555]"
                    placeholder="Jane"
                  />
                </div>
                <div>
                  <label className="block text-[#888] text-xs uppercase tracking-widest mb-2">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full bg-[#0a1520] border border-[#D4AF37]/20 text-[#ededed] px-4 py-3 text-sm tracking-wide font-mono focus:outline-none focus:border-[#D4AF37]/60 transition-colors placeholder-[#555]"
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#888] text-xs uppercase tracking-widest mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="w-full bg-[#0a1520] border border-[#D4AF37]/20 text-[#ededed] px-4 py-3 text-sm tracking-wide font-mono focus:outline-none focus:border-[#D4AF37]/60 transition-colors placeholder-[#555]"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="block text-[#888] text-xs uppercase tracking-widest mb-2">
                  Phone <span className="text-[#555]">(optional)</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                  className="w-full bg-[#0a1520] border border-[#D4AF37]/20 text-[#ededed] px-4 py-3 text-sm tracking-wide font-mono focus:outline-none focus:border-[#D4AF37]/60 transition-colors placeholder-[#555]"
                  placeholder="+1 (555) 000-0000"
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
                  autoComplete="new-password"
                  className="w-full bg-[#0a1520] border border-[#D4AF37]/20 text-[#ededed] px-4 py-3 text-sm tracking-wide font-mono focus:outline-none focus:border-[#D4AF37]/60 transition-colors placeholder-[#555]"
                  placeholder="Min 8 characters"
                />
              </div>

              <div>
                <label className="block text-[#888] text-xs uppercase tracking-widest mb-2">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full bg-[#0a1520] border border-[#D4AF37]/20 text-[#ededed] px-4 py-3 text-sm tracking-wide font-mono focus:outline-none focus:border-[#D4AF37]/60 transition-colors placeholder-[#555]"
                  placeholder="Repeat password"
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
                    Creating Account...
                  </span>
                ) : (
                  "Create Account"
                )}
              </button>
            </form>

            <a
              href="/login"
              className="block w-full text-[#888] text-xs uppercase tracking-widest mt-6 hover:text-[#00F0FF] transition-colors text-center"
            >
              Already have an account? Sign in
            </a>

            <p className="text-xs text-[#555] tracking-widest uppercase text-center mt-4">
              Privacy-first -- Encrypted Sessions
            </p>
          </div>

          <div className="text-center mt-6">
            <a
              href="/"
              className="text-[#888] text-xs uppercase tracking-widest hover:text-[#00F0FF] transition-colors"
            >
              &#8592; Back to Home
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

export default function RegisterClient() {
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
      <RegisterForm />
    </Suspense>
  );
}
