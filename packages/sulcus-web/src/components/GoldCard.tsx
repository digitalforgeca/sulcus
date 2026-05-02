'use client';

/**
 * GoldCard — the canonical Sulcus container with gold-highlighted corners.
 * Use this across all dashboard pages for visual consistency.
 */
export default function GoldCard({
  children,
  className = '',
  padding = 'p-5',
}: {
  children: React.ReactNode;
  className?: string;
  padding?: string;
}) {
  return (
    <div className={`bg-[#0a1520] ${padding} relative border border-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.05)] ${className}`}>
      <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]" />
      <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#D4AF37]" />
      <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#D4AF37]" />
      <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]" />
      {children}
    </div>
  );
}
