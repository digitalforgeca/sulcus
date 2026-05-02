import type { Metadata } from 'next';
import StatusClient from './StatusClient';

export const metadata: Metadata = {
  title: 'System Status',
  description: 'Real-time health and aggregate statistics for the Sulcus memory network. Auto-refreshes every 30 seconds.',
};

export default function StatusPage() {
  return <StatusClient />;
}
