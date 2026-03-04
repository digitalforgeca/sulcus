import Link from "next/link";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] flex">
      <aside className="w-64 border-r border-[#222] p-6 flex flex-col gap-4">
        <div className="font-bold text-xl mb-8 tracking-tighter text-[#ff3e00]">SULCUS</div>
        <nav className="flex flex-col gap-2">
          <Link href="/dashboard" className="text-[#888] hover:text-white transition-colors">Overview</Link>
          <Link href="/dashboard/agents" className="text-[#888] hover:text-white transition-colors">Agents</Link>
          <Link href="/dashboard/billing" className="text-[#888] hover:text-white transition-colors">Billing</Link>
        </nav>
      </aside>
      <main className="flex-1 p-12">
        {children}
      </main>
    </div>
  );
}
