'use client';

import Link from 'next/link';
import { useAuth } from '@/components/providers';

/**
 * Minimal site-wide navigation bar.
 * Gold SULCUS wordmark left, icon links right: GitHub, Docs, Sign In / Dashboard+Logout.
 */
export function SiteNav() {
  const { user, loading, logout } = useAuth();

  return (
    <nav className="flex justify-between items-center py-6 md:py-8 border-b border-[#D4AF37]/30">
      <Link href="/" className="text-xl md:text-2xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-2">
        <div className="w-2.5 h-2.5 md:w-3 md:h-3 bg-[#00F0FF] rounded-sm shadow-[0_0_8px_#00F0FF]" />
        SULCUS
      </Link>

      <div className="flex items-center gap-5 md:gap-6">
        {/* GitHub */}
        <a
          href="https://github.com/digitalforgeca/sulcus"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#888] hover:text-white transition-colors"
          aria-label="GitHub"
          title="GitHub"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
          </svg>
        </a>

        {/* Docs */}
        <Link
          href="/docs"
          className="text-[#888] hover:text-white transition-colors"
          aria-label="Documentation"
          title="Documentation"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
          </svg>
        </Link>

        {/* Auth: Sign In when logged out, Dashboard + Logout when logged in */}
        {!loading && (
          user ? (
            <>
              {/* Dashboard */}
              <Link
                href="/dashboard"
                className="text-[#00F0FF] hover:text-white transition-colors"
                aria-label="Dashboard"
                title="Dashboard"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </Link>

              {/* Log Out */}
              <button
                onClick={() => logout()}
                className="text-[#888] hover:text-[#FF6B6B] transition-colors"
                aria-label="Log Out"
                title="Log Out"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </button>
            </>
          ) : (
            /* Sign In */
            <Link
              href="/login"
              className="text-[#D4AF37] hover:text-[#00F0FF] transition-colors"
              aria-label="Sign In"
              title="Sign In"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                <polyline points="10 17 15 12 10 7"/>
                <line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
            </Link>
          )
        )}
      </div>
    </nav>
  );
}
