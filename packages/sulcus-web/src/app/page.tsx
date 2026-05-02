import type { Metadata } from 'next';
import HomeClient from './HomeClient';

export const metadata: Metadata = {
  title: 'SULCUS — Thermodynamic Memory for AI Agents',
  description: 'Your agent forgets everything the moment its context window fills. Sulcus gives it real memory — a thermodynamic graph that heats what matters, cools what doesn\'t, and pages the right context in at the right time.',
  openGraph: {
    title: 'SULCUS — Thermodynamic Memory for AI Agents',
    description: 'Your agent forgets everything the moment its context window fills. Sulcus gives it real memory — a thermodynamic graph that heats what matters, cools what doesn\'t, and pages the right context in at the right time.',
  },
};

export default function HomePage() {
  return <HomeClient />;
}
