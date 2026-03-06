'use client';

import Link from "next/link";
import { useState } from "react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);

  const navLinks = (
    <>
      <Link 
        href="/dashboard" 
        className="text-[#888] hover:text-white transition-colors"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        Overview
      </Link>
      <Link 
        href="/dashboard/agents" 
        className="text-[#888] hover:text-white transition-colors"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        Agents
      </Link>
      <Link 
        href="/dashboard/memories" 
        className="text-[#888] hover:text-white transition-colors"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        Memories
      </Link>
      <Link 
        href="/dashboard/billing" 
        className="text-[#888] hover:text-white transition-colors"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        Billing
      </Link>
      <Link 
        href="/dashboard/account" 
        className="text-[#888] hover:text-white transition-colors mt-auto pt-4 border-t border-[#222]"
        onClick={() => setIsMobileMenuOpen(false)}
      >
        Account & Identity
      </Link>
    </>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-[#222]">
        <div className="font-bold text-xl tracking-tighter text-[#D4AF37]">SULCUS</div>
        <button 
          onClick={toggleMobileMenu}
          className="p-2 text-[#888] hover:text-white transition-colors"
          aria-label="Toggle Menu"
        >
          {isMobileMenuOpen ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          )}
        </button>
      </div>

      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex w-64 border-r border-[#222] p-6 flex-col gap-4">
        <div className="font-bold text-xl mb-8 tracking-tighter text-[#D4AF37]">SULCUS</div>
        <nav className="flex flex-col gap-2">
          {navLinks}
        </nav>
      </aside>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300"
          onClick={toggleMobileMenu}
        />
      )}

      {/* Mobile Menu Drawer */}
      <div className={`
        fixed top-0 left-0 h-full w-64 bg-[#0a0a0a] border-r border-[#222] z-50 p-6 flex flex-col gap-4
        transition-transform duration-300 transform md:hidden
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center justify-between mb-8">
          <div className="font-bold text-xl tracking-tighter text-[#D4AF37]">SULCUS</div>
          <button onClick={toggleMobileMenu} className="text-[#888] hover:text-white">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <nav className="flex flex-col gap-4 text-lg">
          {navLinks}
        </nav>
      </div>

      <main className="flex-1 p-6 md:p-12 overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
