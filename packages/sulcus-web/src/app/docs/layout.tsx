import Link from "next/link";

const DOC_NAV = [
  { href: "/docs", label: "Overview" },
  { href: "/docs/sdks", label: "SDKs" },
  { href: "/docs/api", label: "API Reference" },
  { href: "/docs/triggers", label: "Triggers" },
  { href: "/docs/local-panel", label: "Local Panel" },
  { href: "/docs/self-hosting", label: "Self-Hosting" },
];

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed] font-mono">
      <div className="max-w-6xl mx-auto flex">
        {/* Sidebar */}
        <nav className="hidden md:block w-56 shrink-0 border-r border-[#D4AF37]/10 py-16 pr-6 sticky top-0 h-screen overflow-y-auto">
          <div className="text-[10px] text-[#666] uppercase tracking-widest mb-4">Documentation</div>
          <ul className="space-y-1">
            {DOC_NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block text-xs text-[#888] hover:text-[#ededed] py-1.5 px-2 hover:bg-[#D4AF37]/5 transition-colors tracking-wider"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="text-[10px] text-[#666] uppercase tracking-widest mb-4 mt-8">Articles</div>
          <ul className="space-y-1">
            <li><Link href="/articles/why-agents-forget" className="block text-xs text-[#888] hover:text-[#ededed] py-1.5 px-2 hover:bg-[#D4AF37]/5 transition-colors tracking-wider">Why Agents Forget</Link></li>
            <li><Link href="/articles/thermodynamic-memory" className="block text-xs text-[#888] hover:text-[#ededed] py-1.5 px-2 hover:bg-[#D4AF37]/5 transition-colors tracking-wider">Thermodynamic Memory</Link></li>
            <li><Link href="/articles/what-memory-feels-like" className="block text-xs text-[#888] hover:text-[#ededed] py-1.5 px-2 hover:bg-[#D4AF37]/5 transition-colors tracking-wider">What Memory Feels Like</Link></li>
          </ul>
        </nav>

        {/* Content */}
        <main className="flex-1 py-16 px-6 md:px-12 max-w-4xl">
          {children}
        </main>
      </div>
    </div>
  );
}
