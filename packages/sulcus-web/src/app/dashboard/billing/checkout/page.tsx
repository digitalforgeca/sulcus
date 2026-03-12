'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js';

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    'pk_test_51T9sL6E2tKgsZqDKoYm7M6ZsI9GDUENWAeEAGfpVrQ0UdSvyZEAXi96OZ8z9h98lpEjwMs0vXYmW4TwtKJHqf2Vz00ZSdSU50n'
);

const SERVER_URL =
  process.env.NEXT_PUBLIC_SULCUS_SERVER_URL ||
  'https://sulcus-server.calmstone-a7a24a97.westus.azurecontainerapps.io';
const API_KEY = process.env.NEXT_PUBLIC_SULCUS_API_KEY || '';

function CheckoutContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const priceId = searchParams.get('price') || '';
  const planName = searchParams.get('plan') || 'Sulcus';
  const [error, setError] = useState('');

  const fetchClientSecret = useCallback(async () => {
    const res = await fetch(`${SERVER_URL}/api/v1/billing/create-checkout-session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ price_id: priceId, embedded: true }),
    });

    if (!res.ok) {
      setError('Failed to create checkout session');
      throw new Error('Failed to create checkout session');
    }

    const data = await res.json();
    return data.clientSecret;
  }, [priceId]);

  if (!priceId) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center">
        <p className="text-red-400 font-mono">No plan selected.</p>
        <button
          onClick={() => router.push('/dashboard/billing')}
          className="mt-4 text-[#00F0FF] border border-[#00F0FF]/30 px-4 py-2 hover:bg-[#00F0FF]/10 text-sm uppercase tracking-widest"
        >
          ← Back to Plans
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto font-sans">
      <div className="mb-6">
        <button
          onClick={() => router.push('/dashboard/billing')}
          className="text-xs text-[#555] hover:text-[#D4AF37] uppercase tracking-widest mb-4 inline-block"
        >
          ← Back to Plans
        </button>
        <h1 className="text-2xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
          <div className="w-2 h-2 bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]" />
          Subscribe to {planName}
        </h1>
        <p className="text-[#555] text-sm mt-1">
          Secure checkout powered by Stripe
        </p>
      </div>

      {error && (
        <div className="bg-red-950/30 border border-red-500/50 text-red-400 p-4 font-mono tracking-wider mb-6">
          {error}
        </div>
      )}

      <div className="bg-[#0a1520] border border-[#D4AF37]/30 p-1 rounded-lg overflow-hidden">
        <EmbeddedCheckoutProvider
          stripe={stripePromise}
          options={{ fetchClientSecret }}
        >
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="text-[#888] font-mono animate-pulse p-8 text-center uppercase tracking-widest">
          Preparing checkout…
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
