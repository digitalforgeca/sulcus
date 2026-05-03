'use client';

import Link from 'next/link';
import { useState } from 'react';
import { SiteNav } from '@/components/site-nav';
import { TIERS } from '@/lib/pricing';

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0 mt-0.5"
    >
      <path
        d="M2 7L5.5 10.5L12 3.5"
        stroke="#22c55e"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const FAQS = [
  {
    q: 'Can I change plans later?',
    a: 'Yes — upgrade or downgrade at any time from your billing dashboard. Changes take effect immediately and are prorated.',
  },
  {
    q: 'Is there a free trial?',
    a: 'The Free tier is free forever. No trial period, no credit card required. Upgrade only when you need more.',
  },
  {
    q: 'What payment methods do you accept?',
    a: 'Visa, Mastercard, and American Express via Stripe. All transactions are encrypted and PCI-compliant.',
  },
  {
    q: 'Can I self-host?',
    a: 'Yes. The local MCP sidecar is always free to self-host. Cloud sync and team features require a paid plan.',
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#1a2a3a]">
      <button
        className="w-full text-left py-5 flex justify-between items-center gap-4 group"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="text-sm font-mono text-white group-hover:text-[#D4AF37] transition-colors tracking-wide">
          {q}
        </span>
        <span
          className="text-[#D4AF37] text-lg leading-none shrink-0 transition-transform duration-200"
          style={{ transform: open ? 'rotate(45deg)' : 'rotate(0deg)' }}
        >
          +
        </span>
      </button>
      {open && (
        <p className="pb-5 text-sm text-[#888] font-sans leading-relaxed pr-8">{a}</p>
      )}
    </div>
  );
}

export default function PricingClient() {
  return (
    <div className="min-h-screen bg-[#050a0f] text-white font-mono overflow-hidden relative">
      <div className="fixed top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent opacity-30 z-50" />

      <div className="max-w-6xl mx-auto px-4 md:px-8 relative z-10">
        <SiteNav />

        <header className="text-center py-20 md:py-28 relative">
          <div className="flex items-center justify-center mb-8 opacity-50">
            <div className="h-[1px] w-16 bg-gradient-to-l from-[#D4AF37] to-transparent" />
            <div className="w-2 h-2 rotate-45 bg-[#00F0FF] mx-4 shadow-[0_0_5px_#00F0FF]" />
            <div className="h-[1px] w-16 bg-gradient-to-r from-[#D4AF37] to-transparent" />
          </div>

          <h1 className="text-4xl md:text-6xl font-bold mb-4 tracking-tighter text-white uppercase">
            Pricing &amp; Plans
          </h1>
          <p className="text-[#D4AF37] text-lg tracking-widest uppercase mb-3">
            Simple, transparent pricing.
          </p>
          <p className="text-[#00F0FF]/60 text-sm tracking-wider font-mono">
            Free tier forever. Scale when you need to.
          </p>
        </header>

        <section className="pb-16">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            {TIERS.map((tier) => (
              <div
                key={tier.key}
                className={[
                  'relative flex flex-col p-8 border transition-all duration-300',
                  tier.highlighted
                    ? 'border-[#D4AF37] shadow-[0_0_40px_rgba(212,175,55,0.12)]'
                    : 'border-[#1a2a3a] hover:border-[#D4AF37]/40',
                  'bg-[#0a1520]/30',
                ].join(' ')}
              >
                {tier.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-0.5 bg-[#D4AF37] text-[#050a0f] text-[10px] font-bold tracking-widest uppercase">
                    {tier.badge}
                  </div>
                )}

                <div className="text-xs tracking-[0.4em] text-[#00F0FF] uppercase mb-6">
                  {tier.name}
                </div>

                <div className="flex items-end gap-2 mb-1">
                  <span className="text-4xl font-mono font-bold text-white">
                    ${tier.price}
                  </span>
                  {tier.price > 0 && (
                    <span className="text-[#555] text-sm pb-1">/mo</span>
                  )}
                </div>
                {tier.price > 0 && (
                  <div className="text-[10px] text-[#555] tracking-widest uppercase mb-2">
                    USD
                  </div>
                )}

                <p className="text-xs text-[#888] font-sans leading-relaxed mb-8">
                  {tier.description}
                </p>

                <ul className="space-y-3 mb-10 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-xs text-[#ccc] font-sans">
                      <CheckIcon />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href={tier.href}
                  className={[
                    'block text-center py-3 text-xs font-bold tracking-widest uppercase transition-all',
                    tier.highlighted
                      ? 'bg-[#D4AF37] text-[#050a0f] hover:brightness-110 shadow-[0_0_16px_rgba(212,175,55,0.3)]'
                      : 'border border-[#D4AF37]/40 text-[#D4AF37] hover:border-[#D4AF37] hover:bg-[#D4AF37]/5',
                  ].join(' ')}
                >
                  {tier.cta}
                </Link>
              </div>
            ))}
          </div>

          <p className="text-center text-[10px] text-[#444] tracking-widest uppercase mt-6">
            All prices in USD &middot; Billed monthly &middot; Cancel anytime
          </p>
        </section>

        <section className="py-16 border-t border-[#D4AF37]/20 max-w-2xl mx-auto">
          <h2 className="text-xs tracking-[0.5em] text-[#D4AF37] uppercase mb-10 text-center">
            Frequently Asked Questions
          </h2>
          <div>
            {FAQS.map((faq) => (
              <FaqItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        </section>

        <footer className="py-16 border-t border-[#D4AF37]/20 text-center">
          <div className="flex justify-center gap-8 mb-8 text-xs text-[#555] uppercase tracking-widest">
            <a href="/docs/sdks" className="hover:text-white transition-colors">SDKs</a>
            <a href="/docs" className="hover:text-white transition-colors">Docs</a>
            <a href="/articles" className="hover:text-white transition-colors">Articles</a>
            <a href="mailto:contact@sulcus.ca" className="hover:text-white transition-colors">Contact</a>
          </div>
          <p className="text-[10px] text-[#2a4a5a] tracking-[0.3em] font-medium uppercase hover:text-[#00F0FF]/50 transition-colors cursor-default">
            © 2026 Digital Forge Studios Inc.
          </p>
        </footer>
      </div>
    </div>
  );
}
