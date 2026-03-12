'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { loadStripe, Appearance } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    'pk_test_51T9sL6E2tKgsZqDKoYm7M6ZsI9GDUENWAeEAGfpVrQ0UdSvyZEAXi96OZ8z9h98lpEjwMs0vXYmW4TwtKJHqf2Vz00ZSdSU50n'
);

import { SERVER_URL, authHeaders } from '@/lib/api';

/** Stripe Elements appearance — dark theme matching Sulcus dashboard */
const appearance: Appearance = {
  theme: 'night',
  variables: {
    colorPrimary: '#D4AF37',
    colorBackground: '#0a1520',
    colorText: '#e0e0e0',
    colorDanger: '#ff4444',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    spacingUnit: '4px',
    borderRadius: '2px',
    fontSizeBase: '14px',
  },
  rules: {
    '.Input': {
      backgroundColor: '#0d1a26',
      border: '1px solid rgba(212, 175, 55, 0.3)',
      color: '#e0e0e0',
    },
    '.Input:focus': {
      border: '1px solid #D4AF37',
      boxShadow: '0 0 8px rgba(212, 175, 55, 0.2)',
    },
    '.Label': {
      color: '#888',
      fontSize: '11px',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.1em',
    },
  },
};

/** Inner form — uses Stripe hooks, must be inside <Elements> */
function PaymentForm({
  planName,
  priceLabel,
}: {
  planName: string;
  priceLabel: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    setError('');

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/dashboard/billing?success=true`,
      },
    });

    if (confirmError) {
      setError(confirmError.message || 'Payment failed');
      setProcessing(false);
    }
    // If no error, Stripe redirects to return_url
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-[#0d1a26] border border-[#D4AF37]/20 p-6">
        <PaymentElement
          options={{
            layout: 'tabs',
          }}
        />
      </div>

      {error && (
        <div className="bg-red-950/30 border border-red-500/50 text-red-400 p-3 font-mono text-sm tracking-wider">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full py-3 text-sm uppercase tracking-[0.2em] font-mono
          border border-[#D4AF37]/60 text-[#D4AF37] bg-[#D4AF37]/5
          hover:bg-[#D4AF37]/15 hover:border-[#D4AF37]
          disabled:opacity-40 disabled:cursor-not-allowed
          transition-all duration-200"
      >
        {processing ? 'Processing…' : `Subscribe to ${planName} · ${priceLabel}`}
      </button>

      <p className="text-[#444] text-xs text-center font-mono">
        Secure payment via Stripe · Cancel anytime
      </p>
    </form>
  );
}

/** Outer wrapper — fetches client_secret, renders Elements provider */
function CheckoutContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const priceId = searchParams.get('price') || '';
  const planName = searchParams.get('plan') || 'Sulcus';
  const priceLabel = searchParams.get('amount') || '';
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!priceId) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const hdrs = await authHeaders();
        const res = await fetch(
          `${SERVER_URL}/api/v1/billing/create-subscription`,
          {
            method: 'POST',
            headers: hdrs,
            body: JSON.stringify({ price_id: priceId }),
          }
        );

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || 'Failed to create subscription');
        }

        const data = await res.json();
        setClientSecret(data.clientSecret);
      } catch (err: any) {
        setError(err.message || 'Something went wrong');
      } finally {
        setLoading(false);
      }
    })();
  }, [priceId]);

  if (!priceId) {
    return (
      <div className="max-w-lg mx-auto p-8 text-center">
        <p className="text-red-400 font-mono text-sm">No plan selected.</p>
        <button
          onClick={() => router.push('/dashboard/billing')}
          className="mt-4 text-[#555] hover:text-[#D4AF37] text-xs uppercase tracking-widest"
        >
          ← Back to Plans
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto font-sans">
      <div className="mb-8">
        <button
          onClick={() => router.push('/dashboard/billing')}
          className="text-xs text-[#555] hover:text-[#D4AF37] uppercase tracking-widest mb-6 inline-block"
        >
          ← Back to Plans
        </button>
        <h1 className="text-xl font-bold tracking-[0.15em] text-[#D4AF37] uppercase flex items-center gap-3">
          <div className="w-1.5 h-1.5 bg-[#00F0FF] shadow-[0_0_6px_#00F0FF]" />
          Subscribe to {planName}
        </h1>
      </div>

      {error && (
        <div className="bg-red-950/30 border border-red-500/50 text-red-400 p-4 font-mono text-sm tracking-wider mb-6">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-[#555] font-mono text-sm animate-pulse uppercase tracking-widest py-12 text-center">
          Preparing payment…
        </div>
      )}

      {clientSecret && (
        <Elements
          stripe={stripePromise}
          options={{ clientSecret, appearance }}
        >
          <PaymentForm planName={planName} priceLabel={priceLabel} />
        </Elements>
      )}
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="text-[#555] font-mono animate-pulse p-8 text-center uppercase tracking-widest">
          Loading…
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
