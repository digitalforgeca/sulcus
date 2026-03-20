'use client';

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/providers";
import { IS_LOCAL_MODE } from "@/lib/api";
import {
  TbLayoutDashboard,
  TbTopologyRing,
  TbUserCircle,
  TbMenu2,
  TbX,
  TbBolt,
  TbHistory,
  TbFlame,
  TbTargetArrow,
  TbSettings,
  TbChevronDown,
} from "react-icons/tb";
import { motion, AnimatePresence } from "framer-motion";
import { ToastProvider } from "@/components/toast";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const coreNavLinks = (
    <>
      {IS_LOCAL_MODE && (
        <div className="flex items-center gap-2 px-2 py-1 mb-2 bg-[#00F0FF]/5 border border-[#00F0FF]/20 rounded text-[10px] uppercase tracking-widest text-[#00F0FF]/70">
          <div className="w-1.5 h-1.5 rounded-full bg-[#00F0FF] animate-pulse" />
          Local Mode
        </div>
      )}

      <Link
        href="/dashboard"
        className="flex items-center gap-3 text-[#888] hover:text-[#D4AF37] transition-colors p-2"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <TbLayoutDashboard size={18} />
        <span>Overview</span>
      </Link>
      <Link
        href="/dashboard/memories"
        className="flex items-center gap-3 text-[#888] hover:text-[#D4AF37] transition-colors p-2"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <TbTopologyRing size={18} />
        <span>Memories</span>
      </Link>
      <Link
        href="/dashboard/triggers"
        className="flex items-center gap-3 text-[#888] hover:text-[#D4AF37] transition-colors p-2"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <TbTargetArrow size={18} />
        <span>Triggers</span>
      </Link>
      <Link
        href="/dashboard/activity"
        className="flex items-center gap-3 text-[#888] hover:text-[#D4AF37] transition-colors p-2"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <TbHistory size={18} />
        <span>Activity</span>
      </Link>
      {!IS_LOCAL_MODE && (
        <Link
          href="/dashboard/gamification"
          className="flex items-center gap-3 text-[#888] hover:text-[#D4AF37] transition-colors p-2"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <TbFlame size={18} />
          <span>Gamification</span>
        </Link>
      )}

      {/* Single Account link replacing Account + Billing + Settings */}
      <Link
        href="/dashboard/account"
        className="flex items-center gap-3 text-[#888] hover:text-[#D4AF37] transition-colors mt-auto pt-4 border-t border-[#222] p-2"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <TbSettings size={18} />
        <span>Account</span>
      </Link>
    </>
  );

  return (
    <ToastProvider>
    <div className="min-h-screen bg-[#050a0f] text-[#ededed] flex flex-col md:flex-row font-mono">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-[#D4AF37]/20 bg-[#0a1520]">
        <div className="font-bold text-xl tracking-tighter text-[#D4AF37] flex items-center gap-2">
          <TbBolt size={20} className="text-[#00F0FF]" />
          SULCUS
        </div>
        <div className="flex items-center gap-3">
          {!IS_LOCAL_MODE && (
            <Link
              href="/dashboard/account"
              className="text-[#888] hover:text-[#D4AF37] transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <TbUserCircle size={22} />
            </Link>
          )}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 text-[#888] hover:text-white transition-colors"
            aria-label="Toggle Menu"
          >
            {isMobileMenuOpen ? <TbX size={24} /> : <TbMenu2 size={24} />}
          </button>
        </div>
      </div>

      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex w-56 border-r border-[#D4AF37]/20 p-6 flex-col gap-4 bg-[#0a1520] shrink-0">
        <div className="font-bold text-2xl mb-12 tracking-widest text-[#D4AF37] flex items-center gap-3">
          <div className="w-3 h-3 bg-[#00F0FF] shadow-[0_0_10px_#00F0FF]"></div>
          SULCUS
        </div>
        <nav className="flex flex-col gap-4 h-full">
          {coreNavLinks}
          {/* Bottom upgrade nudge for local mode */}
          {IS_LOCAL_MODE && (
            <div className="mt-auto pt-4 border-t border-[#222] p-2">
              <a
                href="https://sulcus.ca"
                target="_blank"
                rel="noopener"
                className="flex items-center gap-2 text-xs text-[#555] hover:text-[#D4AF37] transition-colors"
              >
                <TbBolt size={14} className="text-[#D4AF37]/50" />
                <span>Upgrade to Cloud</span>
              </a>
            </div>
          )}
        </nav>
      </aside>

      {/* Mobile Menu Drawer */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-40 md:hidden"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 h-full w-72 bg-[#050a0f] border-r border-[#D4AF37]/30 z-50 p-8 flex flex-col gap-6"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="font-bold text-2xl tracking-widest text-[#D4AF37]">SULCUS</div>
                <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="text-[#888] hover:text-white">
                  <TbX size={24} />
                </button>
              </div>
              <nav className="flex flex-col gap-6 text-lg h-full">
                {coreNavLinks}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main content column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar with user info (desktop only) */}
        {!IS_LOCAL_MODE && (
          <div className="hidden md:flex items-center justify-end px-8 py-3 border-b border-[#D4AF37]/10 bg-[#0a1520]/50 gap-4">
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-2 text-[#888] hover:text-[#D4AF37] transition-colors text-sm"
              >
                <TbUserCircle size={18} className="text-[#00F0FF]/70" />
                <span className="font-mono text-xs tracking-wide truncate max-w-[200px]">
                  {user?.email || "Account"}
                </span>
                <TbChevronDown size={12} className={`transition-transform ${userMenuOpen ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {userMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-44 bg-[#0a1520] border border-[#D4AF37]/20 rounded-sm shadow-xl z-50"
                  >
                    <Link
                      href="/dashboard/account"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-xs text-[#888] hover:text-[#D4AF37] hover:bg-[#D4AF37]/5 transition-colors uppercase tracking-widest"
                    >
                      <TbUserCircle size={14} /> Profile
                    </Link>
                    <Link
                      href="/dashboard/account?tab=billing"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-xs text-[#888] hover:text-[#D4AF37] hover:bg-[#D4AF37]/5 transition-colors uppercase tracking-widest"
                    >
                      <TbBolt size={14} /> Billing
                    </Link>
                    <Link
                      href="/dashboard/account?tab=settings"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-xs text-[#888] hover:text-[#D4AF37] hover:bg-[#D4AF37]/5 transition-colors uppercase tracking-widest"
                    >
                      Settings
                    </Link>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        <main className="flex-1 p-6 md:p-10 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
    </ToastProvider>
  );
}
