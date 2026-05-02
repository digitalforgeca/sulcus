import type { Metadata } from 'next';
import MemoryGraphClient from './MemoryGraphClient';

export const metadata: Metadata = {
  title: 'Memory Graph',
  description: 'Visualize your memory graph. Every node is a memory, every edge is a relationship. Heat-driven ring layout with zoom, pan, and interactive node inspection.',
};

export default function MemoryGraphPage() {
  return <MemoryGraphClient />;
}
