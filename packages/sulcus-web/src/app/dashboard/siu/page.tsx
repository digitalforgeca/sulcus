'use client';

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** SIU controls have moved to the Agents page. */
export default function SiuRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/agents");
  }, [router]);
  return (
    <div className="min-h-[200px] flex items-center justify-center text-[#888] text-sm font-mono animate-pulse">
      Redirecting to Agents…
    </div>
  );
}
