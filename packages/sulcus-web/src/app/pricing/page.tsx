import type { Metadata } from 'next';
import PricingClient from './PricingClient';

export const metadata: Metadata = {
  title: 'Pricing & Plans',
  description: 'Simple, transparent pricing. Free tier forever. Scale when you need to.',
  openGraph: {
    title: 'Pricing & Plans — SULCUS',
    description: 'Simple, transparent pricing. Free tier forever. Scale when you need to.',
    images: [{ url: 'https://sulcus.ca/icon-512.png', width: 512, height: 512, alt: 'SULCUS — Thermodynamic Memory for AI Agents' }],
  },
};

export default function PricingPage() {
  return <PricingClient />;
}
