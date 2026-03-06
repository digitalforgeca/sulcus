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

  const percentage = (usage.used / usage.limit) * 100;

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">Billing & Subscription</h1>
      
      {status === 'success' && (
        <div className="bg-green-900/20 border border-green-500 text-green-500 p-4 rounded mb-8">
          Upgrade successful! Your account is being provisioned.
        </div>
      )}

      {status === 'canceled' && (
        <div className="bg-yellow-900/20 border border-yellow-500 text-yellow-500 p-4 rounded mb-8">
          Checkout canceled. No changes were made.
        </div>
      )}
      
      <div className="bg-[#111] p-8 rounded-lg border border-[#222] mb-8">
        <h2 className="text-xl font-bold mb-2">Current Plan: Starter</h2>
        <p className="text-[#888] mb-6">You are using the free Local Sidecar tier.</p>
        
        <div className="bg-[#1a1a1a] p-4 rounded border border-[#333] mb-6">
          <div className="flex justify-between mb-2">
            <span className="text-sm">Storage Limit</span>
            <span className="text-sm font-bold">{usage.used} GB / {usage.limit} GB</span>
          </div>
          <div className="w-full bg-[#000] rounded-full h-2">
            <div 
              className="bg-[#ff3e00] h-2 rounded-full transition-all duration-500" 
              style={{ width: `${percentage}%` }}
            ></div>
          </div>
        </div>
      </div>

      <div className="bg-[#ff3e00]/10 p-8 rounded-lg border border-[#ff3e00]/30" data-stripe-key={STRIPE_PUBLISHABLE_KEY}>
        <h2 className="text-2xl font-bold mb-2 text-[#ff3e00]">Upgrade to TEAM</h2>
        <p className="text-[#ccc] mb-6">Unlock Remote MCP, 100GB storage, and shared embeddings for your entire agent fleet.</p>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={handleUpgrade}
            disabled={loading}
            aria-label="Upgrade to Team tier via Stripe"
            title="Starts a secure Stripe Checkout session"
            className="bg-[#ff3e00] text-white px-6 py-3 rounded font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Upgrade via Stripe - $299/mo'}
          </button>
          <span className="text-[#555] text-sm">Secure checkout</span>
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
