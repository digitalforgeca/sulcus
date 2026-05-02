"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error") || "Unknown";

  const errorMessages: Record<string, string> = {
    Configuration: "There is a server configuration issue. Please contact support.",
    AccessDenied: "Access denied. You do not have permission to sign in.",
    Verification: "The verification link has expired or has already been used.",
    OAuthSignin: "Could not initiate sign in. Please try again.",
    OAuthCallback: "Authentication callback failed. Please try again.",
    OAuthCreateAccount: "Could not create your account. Please try again.",
    EmailCreateAccount: "Could not create your account. Please try again.",
    Callback: "Authentication failed. Please try again.",
    OAuthAccountNotLinked: "This email is already associated with another sign-in method.",
    Default: "An unexpected error occurred. Please try again.",
  };

  const message = errorMessages[error] || errorMessages.Default;

  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed] font-mono flex items-center justify-center">
      <div className="max-w-md w-full mx-4">
        <div className="border border-[#D4AF37]/30 p-8 relative">
          <div className="absolute -top-3 -left-3 w-6 h-6 border-t-2 border-l-2 border-[#FF6B35]"></div>
          <div className="absolute -bottom-3 -right-3 w-6 h-6 border-b-2 border-r-2 border-[#FF6B35]"></div>

          <div className="text-center mb-8">
            <div className="text-[#FF6B35] text-xs tracking-[0.5em] uppercase mb-4">
              Authentication Error
            </div>
            <h1 className="text-2xl font-bold text-white uppercase tracking-widest mb-2">
              {error}
            </h1>
          </div>

          <p className="text-[#888] font-sans text-sm text-center mb-8 leading-relaxed">
            {message}
          </p>

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

export default function AuthErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#050a0f] flex items-center justify-center">
          <div className="text-[#D4AF37] tracking-widest uppercase text-sm">
            Loading...
          </div>
        </div>
      }
    >
      <ErrorContent />
    </Suspense>
  );
}
