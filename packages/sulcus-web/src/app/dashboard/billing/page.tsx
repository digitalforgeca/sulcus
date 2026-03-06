'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const STRIPE_PUBLISHABLE_KEY = 'pk_test_51RCohtB32qF1jJ7u4Or36ry9lMYYH1aGqAWn0HhqeufLbfnQwjGkCxgDY34rYl07dgUeTrUNhaGTWDBMg4g79ood007VF6hkQc';

function BillingContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'canceled'>('idle');
  const [usage, setUsage] = useState({ used: 1.2, limit: 10 });

  useEffect(() => {
    if (searchParams.get('success')) setStatus('success');
    if (searchParams.get('canceled')) setStatus('canceled');
  }, [searchParams]);

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const token = process.env.NEXT_PUBLIC_SULCUS_API_KEY || '';
      const serverUrl = process.env.NEXT_PUBLIC_SULCUS_SERVER_URL || 'https://sulcus.dforge.ca';
      
      const res = await fetch(`${serverUrl}/api/v1/billing/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ price_id: 'price_team_monthly' })
      });

      if (!res.ok) throw new Error('Failed to create checkout session');
      
      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      alert('Error initiating checkout. Is SULCUS_API_KEY set?');
      setLoading(false);
    }
  };

  const handleManage = async () => {
    setLoading(true);
    try {
      const token = process.env.NEXT_PUBLIC_SULCUS_API_KEY || '';
      const serverUrl = process.env.NEXT_PUBLIC_SULCUS_SERVER_URL || 'https://sulcus.dforge.ca';
      
      const res = await fetch(`${serverUrl}/api/v1/billing/create-portal-session`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) throw new Error('Failed to create portal session');
      
      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      alert('Error initiating portal session. You may not have an active subscription yet.');
      setLoading(false);
    }
  };

  const percentage = (usage.used / usage.limit) * 100;

  return (
    <div className="max-w-2xl font-sans">
      <h1 className="text-3xl font-bold mb-8 tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
        <div className="w-2 h-2 bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"></div>
        Billing & Subscription
      </h1>
      
      {status === 'success' && (
        <div className="bg-[#0a1520] border border-[#00F0FF]/50 text-[#00F0FF] p-4 font-mono tracking-wider flex justify-between items-center mb-8">
          <span>Upgrade successful! Your account is being provisioned.</span>
          <button onClick={() => setStatus('idle')} className="hover:text-white">&times;</button>
        </div>
      )}

      {status === 'canceled' && (
        <div className="bg-red-950/30 border border-red-500/50 text-red-400 p-4 font-mono tracking-wider flex justify-between items-center mb-8">
          <span>Checkout canceled. No changes were made.</span>
          <button onClick={() => setStatus('idle')} className="hover:text-white">&times;</button>
        </div>
      )}
      
      <div className="bg-[#0a1520] p-8 rounded-lg border border-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.05)] relative mb-8">
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#D4AF37]"></div>
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#D4AF37]"></div>
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>

        <h2 className="text-xl font-bold mb-2 text-white uppercase tracking-widest">Current Plan: Starter</h2>
        <p className="text-[#888] mb-6">You are using the free Local Sidecar tier.</p>
        
        <div className="bg-[#111820] p-4 border border-[#D4AF37]/20 mb-6">
          <div className="flex justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-[#888]">Storage Limit</span>
            <span className="text-xs font-bold text-[#D4AF37]">{usage.used} GB / {usage.limit} GB</span>
          </div>
          <div className="w-full bg-black h-1">
            <div 
              className="bg-[#00F0FF] h-1 transition-all duration-500 shadow-[0_0_8px_#00F0FF]" 
              style={{ width: `${percentage}%` }}
            ></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#0a1520] p-8 border border-[#D4AF37]/50 shadow-[0_0_20px_rgba(212,175,55,0.1)] relative" data-stripe-key={STRIPE_PUBLISHABLE_KEY}>
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent"></div>
          
          <h2 className="text-2xl font-bold mb-2 text-[#D4AF37] tracking-widest uppercase">Upgrade to TEAM</h2>
          <p className="text-[#ccc] text-sm mb-6 font-sans">Unlock Remote MCP, 100GB storage, and shared embeddings for your entire agent fleet.</p>
          
          <button 
            onClick={handleUpgrade}
            disabled={loading}
            aria-label="Upgrade to Team tier via Stripe"
            title="Starts a secure Stripe Checkout session"
            className="w-full bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-[#050a0f] px-6 py-3 font-bold hover:brightness-125 transition-all disabled:opacity-50 tracking-widest"
          >
            {loading ? 'PROCESSING...' : 'UPGRADE ($299/MO)'}
          </button>
        </div>

        <div className="bg-[#0a1520] p-8 border border-[#00F0FF]/30 hover:border-[#00F0FF]/60 transition-colors relative">
          <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#00F0FF] to-transparent"></div>
          
          <h2 className="text-xl font-bold mb-2 text-white tracking-widest uppercase">Manage Plan</h2>
          <p className="text-[#ccc] text-sm mb-6 font-sans">Update billing information, download invoices, or cancel your active subscription.</p>
          
          <button 
            onClick={handleManage}
            disabled={loading}
            aria-label="Manage subscription via Stripe Portal"
            className="w-full bg-transparent border border-[#00F0FF] text-[#00F0FF] px-6 py-3 font-bold hover:bg-[#00F0FF]/10 transition-colors tracking-widest text-sm"
          >
            {loading ? 'PROCESSING...' : 'CUSTOMER PORTAL'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div>Loading billing...</div>}>
      <BillingContent />
    </Suspense>
  );
}
