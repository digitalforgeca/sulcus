"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

function JoinRedirect() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");

  useEffect(() => {
    if (token) {
      // Redirect to register page with the invite token
      router.replace(`/register?invite=${encodeURIComponent(token)}`);
    } else {
      // No token — send to register
      router.replace("/register");
    }
  }, [token, router]);

  return (
    <div className="min-h-screen bg-[#050a0f] flex items-center justify-center">
      <div className="text-center">
        <div className="text-[#D4AF37] tracking-widest uppercase text-sm animate-pulse mb-4">
          Processing invitation...
        </div>
        <p className="text-[#555] text-xs tracking-widest">
          Redirecting to registration
        </p>
      </div>
    </div>
  );
}

export default function JoinClient() {
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
      <JoinRedirect />
    </Suspense>
  );
}
