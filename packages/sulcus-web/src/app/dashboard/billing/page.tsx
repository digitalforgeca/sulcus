'use client';

import { useState, useEffect } from 'react';

export default function BillingPage() {
  const [loading, setLoading] = useState(false);
  const [usage, setUsage] = useState({ used: 1.2, limit: 10 });

  const handleUpgrade = async () => {
    setLoading(true);
    // In a real system, this would call /api/v1/billing/create-checkout-session
    // For the PoC, we'll redirect to a generic Stripe payment link or just simulate the flow.
    setTimeout(() => {
      window.location.href = 'https://buy.stripe.com/test_demo_link';
    }, 1000);
  };

  const percentage = (usage.used / usage.limit) * 100;

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">Billing & Subscription</h1>
      
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

      <div className="bg-[#ff3e00]/10 p-8 rounded-lg border border-[#ff3e00]/30">
        <h2 className="text-2xl font-bold mb-2 text-[#ff3e00]">Upgrade to TEAM</h2>
        <p className="text-[#ccc] mb-6">Unlock Remote MCP, 100GB storage, and shared embeddings for your entire agent fleet.</p>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={handleUpgrade}
            disabled={loading}
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
