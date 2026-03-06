'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const STRIPE_PUBLISHABLE_KEY = 'pk_test_51RCohtB32qF1jJ7u4Or36ry9lMYYH1aGqAWn0HhqeufLbfnQwjGkCxgDY34rYl07dgUeTrUNhaGTWDBMg4g79ood007VF6hkQc';

interface Product {
  id: string;
  name: string;
  description: string;
}

interface Price {
  id: string;
  product: string;
  unit_amount: number;
  currency: string;
  recurring?: {
    interval: string;
  };
}

function BillingContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'canceled'>('idle');
  const [usage, setUsage] = useState({ used: 1.2, limit: 10 });
  const [products, setProducts] = useState<Product[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [fetchingProducts, setFetchingProducts] = useState(true);

  useEffect(() => {
    if (searchParams.get('success')) setStatus('success');
    if (searchParams.get('canceled')) setStatus('canceled');

    // Fetch dynamic products
    async function loadProducts() {
      try {
        const serverUrl = process.env.NEXT_PUBLIC_SULCUS_SERVER_URL || 'https://sulcus.dforge.ca';
        const res = await fetch(`${serverUrl}/api/v1/billing/products`);
        if (res.ok) {
          const data = await res.json();
          if (data.products?.data) setProducts(data.products.data);
          if (data.prices?.data) setPrices(data.prices.data);
        }
      } catch (err) {
        console.error("Failed to fetch Stripe products", err);
      } finally {
        setFetchingProducts(false);
      }
    }
    loadProducts();
  }, [searchParams]);

  const handleUpgrade = async (priceId: string) => {
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
        body: JSON.stringify({ price_id: priceId })
      });

      if (!res.ok) throw new Error('Failed to create checkout session');
      
      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      alert('Error initiating checkout. Please ensure you are authenticated.');
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

  // Fallback product if Stripe API is empty (e.g. fresh test account)
  const displayProducts = products.length > 0 ? products : [
    { id: 'prod_fallback', name: 'Sulcus Cortex', description: 'Unlock Remote MCP, 100GB storage, and shared embeddings for your entire agent fleet.' }
  ];
  const displayPrices = prices.length > 0 ? prices : [
    { id: 'price_cortex_monthly', product: 'prod_fallback', unit_amount: 29900, currency: 'usd', recurring: { interval: 'month' } }
  ];

  return (
    <div className="max-w-4xl font-sans">
      <h1 className="text-3xl font-bold mb-8 tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
        <div className="w-2 h-2 bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"></div>
        Subscription & Quota
      </h1>
      
      {status === 'success' && (
        <div className="bg-[#0a1520] border border-[#00F0FF]/50 text-[#00F0FF] p-4 font-mono tracking-wider flex justify-between items-center mb-8">
          <span>Upgrade successful! Your organizational cortex is being provisioned.</span>
          <button onClick={() => setStatus('idle')} className="hover:text-white">&times;</button>
        </div>
      )}

      {status === 'canceled' && (
        <div className="bg-red-950/30 border border-red-500/50 text-red-400 p-4 font-mono tracking-wider flex justify-between items-center mb-8">
          <span>Checkout canceled. No changes were made.</span>
          <button onClick={() => setStatus('idle')} className="hover:text-white">&times;</button>
        </div>
      )}
      
      <div className="bg-[#0a1520] p-8 rounded-lg border border-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.05)] relative mb-12">
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#D4AF37]"></div>
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#D4AF37]"></div>
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>

        <h2 className="text-xl font-bold mb-2 text-white uppercase tracking-widest">Current Plan: Sulcus Open (Local)</h2>
        <p className="text-[#888] mb-6">You are using the free local sidecar tier.</p>
        
        <div className="bg-[#111820] p-4 border border-[#D4AF37]/20 mb-6 max-w-lg">
          <div className="flex justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-[#888]">Storage Quota</span>
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

      <h2 className="text-2xl font-bold mb-6 tracking-widest text-white uppercase">Available Offerings</h2>
      
      {fetchingProducts ? (
        <div className="text-[#888] animate-pulse font-mono text-sm uppercase">Synchronizing pricing with Stripe...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {displayProducts.map(product => {
            const price = displayPrices.find(p => p.product === product.id);
            const priceStr = price ? `$${(price.unit_amount / 100).toFixed(2)}` : 'Custom';
            const interval = price?.recurring?.interval ? `/${price.recurring.interval}` : '';
            
            return (
              <div key={product.id} className="bg-[#0a1520] p-8 border border-[#D4AF37]/50 shadow-[0_0_20px_rgba(212,175,55,0.1)] relative flex flex-col" data-stripe-key={STRIPE_PUBLISHABLE_KEY}>
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent"></div>
                
                <h2 className="text-2xl font-bold mb-2 text-[#D4AF37] tracking-widest uppercase">{product.name}</h2>
                <div className="text-4xl font-mono text-white mb-4">{priceStr}<span className="text-lg text-[#888]">{interval}</span></div>
                
                <p className="text-[#ccc] text-sm mb-8 font-sans flex-1">{product.description || 'Enterprise-grade memory synchronization and scaling.'}</p>
                
                <button 
                  onClick={() => price && handleUpgrade(price.id)}
                  disabled={loading || !price}
                  aria-label={`Upgrade to ${product.name}`}
                  className="w-full bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-[#050a0f] px-6 py-3 font-bold hover:brightness-125 transition-all disabled:opacity-50 tracking-widest uppercase"
                >
                  {loading ? 'PROCESSING...' : 'UPGRADE NOW'}
                </button>
              </div>
            );
          })}

          <div className="bg-[#0a1520] p-8 border border-[#00F0FF]/30 hover:border-[#00F0FF]/60 transition-colors relative flex flex-col">
            <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#00F0FF] to-transparent"></div>
            
            <h2 className="text-xl font-bold mb-2 text-white tracking-widest uppercase">Subscription Management</h2>
            <p className="text-[#ccc] text-sm mb-8 font-sans flex-1">Update billing information, download tax invoices, manage seats, or modify your active subscription directly via the secure Stripe portal.</p>
            
            <button 
              onClick={handleManage}
              disabled={loading}
              className="w-full bg-transparent border border-[#00F0FF] text-[#00F0FF] px-6 py-3 font-bold hover:bg-[#00F0FF]/10 transition-colors tracking-widest text-sm"
            >
              {loading ? 'PROCESSING...' : 'CUSTOMER PORTAL'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="text-[#888] font-mono animate-pulse p-8">Loading billing module...</div>}>
      <BillingContent />
    </Suspense>
  );
}