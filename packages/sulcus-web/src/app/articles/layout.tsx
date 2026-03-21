import Link from "next/link";
import { TbArrowLeft } from "react-icons/tb";
import KeryxNewsletter from "@/components/KeryxNewsletter";

export default function ArticlesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed]">
      <div className="max-w-3xl mx-auto px-6 py-16 font-sans">
        <Link href="/" className="text-[#00F0FF]/60 hover:text-[#00F0FF] text-sm flex items-center gap-1 mb-8">
          <TbArrowLeft size={14} /> Home
        </Link>
        <article className="prose prose-invert prose-sm max-w-none">
          {children}
        </article>
        <div className="border-t border-[#D4AF37]/10 mt-12 pt-8">
          <h3 className="text-sm font-bold text-[#D4AF37] uppercase tracking-widest mb-4">Stay in the Loop</h3>
          <p className="text-xs text-[#888] mb-4">Get updates on Sulcus releases, memory research, and what we&apos;re building.</p>
          <KeryxNewsletter />
          <div className="mt-8">
            <Link href="/docs/sdks" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              View SDKs &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
