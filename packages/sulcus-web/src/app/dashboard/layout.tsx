'use client';

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
  
  TbChevronDown,
  TbSettings,
  TbLogout,
  TbRobot,

} from "react-icons/tb";
import { motion, AnimatePresence } from "framer-motion";
import { ToastProvider } from "@/components/toast";
import { usePathname } from "next/navigation";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Client-side auth guard: redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user && !IS_LOCAL_MODE) {
      router.replace(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
    }
  }, [user, loading, router, pathname]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const navItems = [
    { href: "/dashboard", icon: TbLayoutDashboard, label: "Overview", exact: true },
    { href: "/dashboard/memories", icon: TbTopologyRing, label: "Memories" },
    { href: "/dashboard/activity", icon: TbHistory, label: "Activity" },
    { href: "/dashboard/agents", icon: TbRobot, label: "Agents" },
  ];

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <ToastProvider>
    <div className="min-h-screen bg-[#050a0f] text-[#ededed] flex flex-col font-mono">
      {/* Header — desktop & mobile */}
      <header className="flex items-center justify-between px-4 md:px-8 py-3 border-b border-[#D4AF37]/20 bg-[#0a1520] shrink-0 z-30">
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="font-bold text-xl md:text-2xl tracking-widest text-[#D4AF37] flex items-center gap-2 shrink-0">
            <div className="w-2.5 h-2.5 bg-[#00F0FF] shadow-[0_0_10px_#00F0FF]" />
            SULCUS
          </Link>

          {IS_LOCAL_MODE && (
            <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 bg-[#00F0FF]/5 border border-[#00F0FF]/20 rounded text-[9px] uppercase tracking-widest text-[#00F0FF]/70">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00F0FF] animate-pulse" />
              Local
            </div>
          )}

          {/* Separator */}
          <div className="hidden md:block w-px h-5 bg-[#D4AF37]/20" />

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5">
            {navItems.map(({ href, icon: Icon, label, exact }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 px-3 py-1.5 rounded transition-all text-xs uppercase tracking-widest ${
                  isActive(href, exact)
                    ? "text-[#D4AF37] bg-[#D4AF37]/10 border border-[#D4AF37]/20"
                    : "text-[#555] hover:text-[#D4AF37] hover:bg-[#D4AF37]/5 border border-transparent"
                }`}
                title={label}
              >
                <Icon size={15} />
                <span className="hidden lg:inline">{label}</span>
              </Link>
            ))}
          </nav>
        </div>

        {/* Right: User dropdown + mobile toggle */}
        <div className="flex items-center gap-3">
          {!IS_LOCAL_MODE && (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-2 text-[#888] hover:text-[#D4AF37] transition-colors text-sm"
              >
                <TbUserCircle size={18} className="text-[#00F0FF]/70" />
                <span className="hidden md:inline font-mono text-xs tracking-wide truncate max-w-[200px]">
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
                      href="/dashboard/xp"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-xs text-[#888] hover:text-[#D4AF37] hover:bg-[#D4AF37]/5 transition-colors uppercase tracking-widest"
                    >
                      <TbFlame size={14} /> XP
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
                      className="flex items-center gap-2 px-4 py-2.5 text-xs text-[#888] hover:text-[#D4AF37] hover:bg-[#D4AF37]/5 transition-colors uppercase tracking-widest cursor-pointer"
                    >
                      <TbSettings size={14} /> Settings
                    </Link>
                    <div className="border-t border-[#D4AF37]/10 mx-2" />
                    <button
                      onClick={() => { setUserMenuOpen(false); logout(); }}
                      className="flex items-center gap-2 px-4 py-2.5 text-xs text-[#888] hover:text-[#FF6B6B] hover:bg-[#FF6B6B]/5 transition-colors uppercase tracking-widest w-full cursor-pointer"
                    >
                      <TbLogout size={14} /> Log Out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {IS_LOCAL_MODE && (
            <a
              href="https://sulcus.ca"
              target="_blank"
              rel="noopener"
              className="hidden md:flex items-center gap-1.5 text-[10px] text-[#555] hover:text-[#D4AF37] transition-colors uppercase tracking-widest"
            >
              <TbBolt size={12} className="text-[#D4AF37]/50" />
              Upgrade
            </a>
          )}

          {/* Mobile menu toggle */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2 text-[#888] hover:text-white transition-colors"
            aria-label="Toggle Menu"
          >
            {isMobileMenuOpen ? <TbX size={24} /> : <TbMenu2 size={24} />}
          </button>
        </div>
      </header>

      {/* Mobile Menu Drawer */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-40 md:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
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
                <button onClick={() => setIsMobileMenuOpen(false)} className="text-[#888] hover:text-white">
                  <TbX size={24} />
                </button>
              </div>
              <nav className="flex flex-col gap-4 text-lg">
                {navItems.map(({ href, icon: Icon, label, exact }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`flex items-center gap-3 p-2 transition-colors ${
                      isActive(href, exact) ? "text-[#D4AF37]" : "text-[#888] hover:text-[#D4AF37]"
                    }`}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                  </Link>
                ))}
                {!IS_LOCAL_MODE && (
                  <>
                    <div className="border-t border-[#222] my-2" />
                    <Link
                      href="/dashboard/xp"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={`flex items-center gap-3 p-2 transition-colors ${
                        isActive("/dashboard/xp") ? "text-[#D4AF37]" : "text-[#888] hover:text-[#D4AF37]"
                      }`}
                    >
                      <TbFlame size={18} />
                      <span>XP</span>
                    </Link>
                    <Link
                      href="/dashboard/account"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="flex items-center gap-3 text-[#888] hover:text-[#D4AF37] transition-colors p-2"
                    >
                      <TbUserCircle size={18} />
                      <span>Account</span>
                    </Link>
                  </>
                )}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main content — centered with max-width */}
      <main className="flex-1 w-full px-4 md:px-10 py-6 md:py-10 overflow-x-hidden">
        {children}
      </main>
    </div>
    </ToastProvider>
  );
}
