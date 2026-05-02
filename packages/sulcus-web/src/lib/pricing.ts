/**
 * Sulcus pricing tiers — single source of truth.
 * Used by /pricing (public) and /dashboard/billing (auth'd).
 */

export interface PricingTier {
  /** Internal tier key (matches Stripe metadata.tier) */
  key: string;
  /** Display name */
  name: string;
  /** Emoji prefix for dashboard display */
  emoji: string;
  /** Monthly price in USD (0 = free) */
  price: number;
  /** Short description */
  description: string;
  /** Feature bullet points */
  features: string[];
  /** Stripe price ID (null for free tier) */
  stripePriceId: string | null;
  /** Whether this tier is visually highlighted */
  highlighted: boolean;
  /** Badge text (e.g. "Recommended") */
  badge?: string;
  /** Sub-label for dashboard (e.g. "Growing Teams") */
  dashboardLabel?: string;
  /** CTA button text */
  cta: string;
  /** CTA link (for public pricing page) */
  href: string;
}

export const TIERS: PricingTier[] = [
  {
    key: 'free',
    name: 'Open',
    emoji: '',
    price: 0,
    description: 'Local-first memory for solo builders. Free forever.',
    features: [
      '1 agent',
      '1,000 nodes',
      'Embedded Postgres (pg-embed)',
      'Full MCP tool suite',
      'Community support',
    ],
    stripePriceId: null,
    highlighted: false,
    cta: 'Get Started',
    href: '/login',
  },
  {
    key: 'neuron',
    name: 'Neuron',
    emoji: '⚡',
    price: 29,
    description: 'Cloud sync and reactive triggers for growing teams.',
    features: [
      '5 agents',
      '10,000 nodes',
      'Cloud sync',
      'Reactive memory triggers',
      'Email support',
    ],
    stripePriceId: 'price_1TFnnMCdf82O5H1Wy1AkNdRg',
    highlighted: false,
    dashboardLabel: 'Growing Teams',
    cta: 'Subscribe',
    href: '/dashboard/billing/checkout?price=price_1TFnnMCdf82O5H1Wy1AkNdRg&plan=Neuron&amount=$29',
  },
  {
    key: 'cortex',
    name: 'Cortex',
    emoji: '✨',
    price: 79,
    description: 'Full API access, team namespaces, and priority support.',
    features: [
      '25 agents',
      '50,000 nodes',
      'Remote MCP access',
      'Full API access',
      'Team dashboard',
      'Priority support',
    ],
    stripePriceId: 'price_1TFnnZCdf82O5H1WtSdm0WjW',
    highlighted: true,
    badge: 'Recommended',
    cta: 'Subscribe',
    href: '/dashboard/billing/checkout?price=price_1TFnnZCdf82O5H1WtSdm0WjW&plan=Cortex&amount=$79',
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    emoji: '👑',
    price: 199,
    description: 'Unlimited scale with SSO, SLA, and dedicated support.',
    features: [
      'Unlimited agents',
      'Unlimited nodes',
      'Unlimited sync requests',
      'SSO / SAML',
      'Dedicated support & SLA',
      'Custom retention policy',
    ],
    stripePriceId: 'price_1TFnnlCdf82O5H1WzVVkUhZz',
    highlighted: false,
    dashboardLabel: 'Enterprise',
    cta: 'Subscribe',
    href: '/dashboard/billing/checkout?price=price_1TFnnlCdf82O5H1WzVVkUhZz&plan=Enterprise&amount=$199',
  },
];

/** Tier keys that are paid Stripe products (used to filter Stripe product list) */
export const PAID_TIER_KEYS = TIERS.filter((t) => t.stripePriceId).map((t) => t.key);

/** Look up a tier by its key */
export function getTier(key: string): PricingTier | undefined {
  return TIERS.find((t) => t.key === key);
}

/** Normalize legacy tier names to current keys */
export function normalizeTierKey(raw: string): string {
  if (raw === 'starter' || raw === 'pro') return 'free';
  if (raw === 'team') return 'cortex';
  return raw;
}
