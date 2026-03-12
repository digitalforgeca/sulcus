"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/providers";

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { login, register } = useAuth();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    const result = isLogin
      ? await login(email, password)
      : await register(email, password, name);

    if (result.ok) {
      router.push(callbackUrl);
    } else {
      setError(result.error || "Authentication failed");
      setIsLoading(false);
    }
  };

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

          <div className="text-center mb-8">
            <div className="text-[#00F0FF] text-xs tracking-[0.5em] uppercase mb-4">
              {isLogin ? "Authentication Required" : "Create Account"}
            </div>
            <h1 className="text-xl font-bold text-white uppercase tracking-widest">
              {isLogin ? "Sign In" : "Register"}
            </h1>
          </div>

          {error && (
            <div className="bg-red-950/30 border border-red-500/50 text-red-400 px-4 py-2 text-sm mb-6 tracking-wider">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
            {!isLogin && (
              <input
                id="name"
                name="name"
                type="text"
                placeholder="Name (optional)"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#050a0f] border border-[#D4AF37]/30 px-4 py-3 text-white placeholder-[#555] focus:border-[#00F0FF] focus:outline-none transition-colors text-sm tracking-wider"
              />
            )}
            <input
              id="email"
              name="email"
              type="email"
              placeholder="Email"
              autoComplete={isLogin ? "username" : "email"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-[#050a0f] border border-[#D4AF37]/30 px-4 py-3 text-white placeholder-[#555] focus:border-[#00F0FF] focus:outline-none transition-colors text-sm tracking-wider"
            />
            <input
              id="password"
              name="password"
              type="password"
              placeholder="Password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full bg-[#050a0f] border border-[#D4AF37]/30 px-4 py-3 text-white placeholder-[#555] focus:border-[#00F0FF] focus:outline-none transition-colors text-sm tracking-wider"
            />

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-[#050a0f] px-6 py-4 font-bold hover:brightness-110 transition-all tracking-widest uppercase text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(212,175,55,0.2)]"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-[#050a0f]/30 border-t-[#050a0f] rounded-full animate-spin"></span>
                  {isLogin ? "Signing in..." : "Creating account..."}
                </span>
              ) : isLogin ? (
                "Sign In"
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          <button
            onClick={() => { setIsLogin(!isLogin); setError(""); }}
            className="w-full text-[#888] text-xs uppercase tracking-widest mt-6 hover:text-[#00F0FF] transition-colors"
          >
            {isLogin ? "Need an account? Register" : "Already have an account? Sign In"}
          </button>

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
