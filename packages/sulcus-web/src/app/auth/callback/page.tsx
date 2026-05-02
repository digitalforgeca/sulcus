"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { handleCallback } from "@/lib/auth";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    handleCallback()
      .then(() => {
        // Redirect to dashboard after successful login
        router.replace("/dashboard");
      })
      .catch((err) => {
        console.error("[auth/callback] OIDC callback error:", err);
        setError(err?.message || "Authentication failed");
      });
  }, [router]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#050a0f] text-[#ededed] font-mono flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <div className="border border-[#FF6B35]/30 p-8 relative">
            <div className="absolute -top-3 -left-3 w-6 h-6 border-t-2 border-l-2 border-[#FF6B35]" />
            <div className="absolute -bottom-3 -right-3 w-6 h-6 border-b-2 border-r-2 border-[#FF6B35]" />
            <div className="text-center mb-6">
              <div className="text-[#FF6B35] text-xs tracking-[0.5em] uppercase mb-4">
                Authentication Error
              </div>
              <p className="text-[#888] font-sans text-sm leading-relaxed">{error}</p>
            </div>
            <div className="flex flex-col gap-3">
              <a
                href="/login"
                className="block text-center bg-[#D4AF37] text-[#050a0f] px-6 py-3 font-bold hover:brightness-110 transition-all tracking-widest uppercase text-sm"
              >
                Try Again
              </a>
              <a
                href="/"
                className="block text-center border border-[#888] text-white px-6 py-3 font-bold hover:border-white transition-all tracking-widest uppercase text-sm"
              >
                Back to Home
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050a0f] flex items-center justify-center">
      <div className="text-center">
        <div className="w-3 h-3 bg-[#00F0FF] rounded-sm shadow-[0_0_8px_#00F0FF] mx-auto mb-4 animate-pulse" />
        <div className="text-[#D4AF37] tracking-widest uppercase text-sm animate-pulse">
          Completing sign in…
        </div>
      </div>
    </div>
  );
}
