'use client';

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/providers";
import { 
  TbLayoutDashboard, 
  TbRobot, 
  TbTopologyRing, 
  TbCreditCard, 
  TbUserCircle, 
  TbMenu2, 
  TbX,
  TbBolt,
  TbBuilding,
  TbHistory,
  TbFlame,
  TbSettings,
} from "react-icons/tb";
import { motion, AnimatePresence } from "framer-motion";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);

  const navLinks = (
    <>
      <Link 
        href="/dashboard" 
        className="flex items-center gap-3 text-[#888] hover:text-[#D4AF37] transition-colors p-2"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <TbLayoutDashboard size={18} />
        <span>Overview</span>
      </Link>
      <Link 
        href="/dashboard/agents" 
        className="flex items-center gap-3 text-[#888] hover:text-[#D4AF37] transition-colors p-2"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <TbRobot size={18} />
        <span>Agents</span>
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
        href="/dashboard/activity" 
        className="flex items-center gap-3 text-[#888] hover:text-[#D4AF37] transition-colors p-2"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <TbHistory size={18} />
        <span>Activity</span>
      </Link>
      <Link 
        href="/dashboard/gamification" 
        className="flex items-center gap-3 text-[#888] hover:text-[#D4AF37] transition-colors p-2"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <TbFlame size={18} />
        <span>Profile</span>
      </Link>
      <Link 
        href="/dashboard/billing" 
        className="flex items-center gap-3 text-[#888] hover:text-[#D4AF37] transition-colors p-2"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <TbCreditCard size={18} />
        <span>Billing</span>
      </Link>
      <Link 
        href="/dashboard/settings" 
        className="flex items-center gap-3 text-[#888] hover:text-[#D4AF37] transition-colors p-2"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <TbSettings size={18} />
        <span>Settings</span>
      </Link>
      <Link 
        href="/dashboard/account" 
        className="flex items-center gap-3 text-[#888] hover:text-[#D4AF37] transition-colors mt-auto pt-4 border-t border-[#222] p-2"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <TbUserCircle size={18} />
        <span className="truncate text-sm">{user?.email || 'Account'}</span>
      </Link>
    </>
  );

  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed] flex flex-col md:flex-row font-mono">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-[#D4AF37]/20 bg-[#0a1520]">
        <div className="font-bold text-xl tracking-tighter text-[#D4AF37] flex items-center gap-2">
          <TbBolt size={20} className="text-[#00F0FF]" />
          SULCUS
        </div>
        <button 
          onClick={toggleMobileMenu}
          className="p-2 text-[#888] hover:text-white transition-colors"
          aria-label="Toggle Menu"
        >
          {isMobileMenuOpen ? <TbX size={24} /> : <TbMenu2 size={24} />}
        </button>
      </div>

      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex w-64 border-r border-[#D4AF37]/20 p-6 flex-col gap-4 bg-[#0a1520]">
        <div className="font-bold text-2xl mb-12 tracking-widest text-[#D4AF37] flex items-center gap-3">
          <div className="w-3 h-3 bg-[#00F0FF] shadow-[0_0_10px_#00F0FF]"></div>
          SULCUS
        </div>
        <nav className="flex flex-col gap-4 h-full">
          {navLinks}
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
              onClick={toggleMobileMenu}
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
                <button onClick={toggleMobileMenu} className="text-[#888] hover:text-white">
                  <TbX size={24} />
                </button>
              </div>
              <nav className="flex flex-col gap-6 text-lg h-full">
                {navLinks}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <main className="flex-1 p-6 md:p-12 overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
