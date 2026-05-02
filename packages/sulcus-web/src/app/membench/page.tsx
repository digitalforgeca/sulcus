import type { Metadata } from 'next';
import MemBenchClient from './MemBenchClient';

export const metadata: Metadata = {
  title: 'MemBench — Open AI Memory Benchmark',
  description: 'MemBench v0.1: open benchmark for AI memory systems. 20 tasks across 5 categories — recall, temporal, contradiction, multi-session, and efficiency.',
};

export default function MemBenchPage() {
  return <MemBenchClient />;
}
