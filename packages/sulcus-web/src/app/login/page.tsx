"use client";

import { signIn } from "next-auth/react";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async () => {
    setIsLoading(true);
    await signIn("keycloak", { callbackUrl });
  };

  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed] font-mono flex items-center justify-center relative overflow-hidden">
      {/* Background patterns */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06] z-0"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='100' viewBox='0 0 60 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cg stroke='%2300F0FF' stroke-width='1' fill='none' fill-rule='evenodd'%3E%3Cpath d='M30 0l30 16.5v33L30 66 0 49.5v-33L30 0zm0 100l30-16.5v-33L30 34 0 50.5v33L30 100z'/%3E%3C/g%3E%3C/svg%3E")`,
          backgroundSize: "60px 100px",
        }}
      />

      <div className="max-w-md w-full mx-4 relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <a href="/" className="inline-flex items-center gap-2">
            <div className="w-3 h-3 bg-[#00F0FF] rounded-sm shadow-[0_0_8px_#00F0FF]"></div>
            <span className="text-2xl font-bold tracking-widest text-[#D4AF37] uppercase">
              SULCUS
            </span>
          </a>
        </div>

        {/* Login card */}
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

          <p className="text-[#888] font-sans text-sm text-center mb-8 leading-relaxed">
            Access the SULCUS console to manage your agent memory infrastructure.
          </p>

          <button
            onClick={handleSignIn}
            disabled={isLoading}
            className="w-full bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-[#050a0f] px-6 py-4 font-bold hover:brightness-110 transition-all tracking-widest uppercase text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(212,175,55,0.2)]"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-[#050a0f]/30 border-t-[#050a0f] rounded-full animate-spin"></span>
                Connecting...
              </span>
            ) : (
              "Sign In with SSO"
            )}
          </button>

          <p className="text-xs text-[#555] tracking-widest uppercase text-center mt-6">
            Secured by OIDC · Privacy-first
          </p>
        </div>

        {/* Back link */}
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
  );
}

export default function LoginPage() {
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
