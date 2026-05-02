"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SERVER_URL } from "@/lib/api";

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [invalidToken, setInvalidToken] = useState(false);

  useEffect(() => {
    if (!token) setInvalidToken(true);
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch(`${SERVER_URL}/api/v1/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || (data as any).status === "error") {
        setError((data as any).message || "Failed to reset password.");
        setIsLoading(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const canSubmit =
    password.length >= 8 && password === confirm && !isLoading && !invalidToken;

  return (
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

          {invalidToken ? (
            <div className="text-center py-8">
              <div className="text-[#FF6B35] text-4xl mb-4">✕</div>
              <h1 className="text-xl font-bold text-white uppercase tracking-widest mb-4">
                Invalid Link
              </h1>
              <p className="text-[#888] text-sm leading-relaxed mb-6">
                This password reset link is invalid or has expired. Please
                request a new one.
              </p>
              <a
                href="/forgot-password"
                className="inline-block bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-[#050a0f] px-6 py-3 font-bold tracking-widest uppercase text-sm shadow-[0_0_20px_rgba(212,175,55,0.2)]"
              >
                Request New Link
              </a>
            </div>
          ) : success ? (
            <div className="text-center py-8">
              <div className="text-[#00F0FF] text-4xl mb-4">✓</div>
              <h1 className="text-xl font-bold text-white uppercase tracking-widest mb-4">
                Password Updated
              </h1>
              <p className="text-[#888] text-sm leading-relaxed mb-6">
                Your password has been reset successfully. You can now sign in
                with your new password.
              </p>
              <a
                href="/login"
                className="inline-block bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-[#050a0f] px-6 py-3 font-bold tracking-widest uppercase text-sm shadow-[0_0_20px_rgba(212,175,55,0.2)]"
              >
                Sign In →
              </a>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <div className="text-[#00F0FF] text-xs tracking-[0.5em] uppercase mb-4">
                  Account Recovery
                </div>
                <h1 className="text-xl font-bold text-white uppercase tracking-widest">
                  New Password
                </h1>
                <p className="text-[#888] text-xs mt-3 leading-relaxed">
                  Choose a new password for your account. Must be at least 8
                  characters.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[#888] text-xs uppercase tracking-widest mb-2">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    autoFocus
                    className="w-full bg-[#0a1520] border border-[#D4AF37]/20 text-[#ededed] px-4 py-3 text-sm tracking-wide font-mono focus:outline-none focus:border-[#D4AF37]/60 transition-colors placeholder-[#555]"
                    placeholder="••••••••"
                  />
                </div>

                <div>
                  <label className="block text-[#888] text-xs uppercase tracking-widest mb-2">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    className="w-full bg-[#0a1520] border border-[#D4AF37]/20 text-[#ededed] px-4 py-3 text-sm tracking-wide font-mono focus:outline-none focus:border-[#D4AF37]/60 transition-colors placeholder-[#555]"
                    placeholder="••••••••"
                  />
                  {password && confirm && password !== confirm && (
                    <p className="text-[#FF6B35] text-xs mt-1 tracking-wide">
                      Passwords do not match
                    </p>
                  )}
                </div>

                {error && (
                  <div className="border border-[#FF6B35]/30 bg-[#FF6B35]/5 px-4 py-2 text-[#FF6B35] text-xs tracking-wide">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-[#050a0f] px-6 py-4 font-bold hover:brightness-110 transition-all tracking-widest uppercase text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-[#050a0f]/30 border-t-[#050a0f] rounded-full animate-spin"></span>
                      Updating…
                    </span>
                  ) : (
                    "Set New Password"
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
  );
}

export default function ResetPasswordClient() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#050a0f] flex items-center justify-center">
          <div className="text-[#D4AF37] tracking-widest uppercase text-sm animate-pulse">
            Loading...
          </div>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
