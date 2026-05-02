import type { Metadata } from 'next';
import TriggersClient from './TriggersClient';

export const metadata: Metadata = {
  title: 'Reactive Triggers',
  description: 'Set rules on your memory graph. When memory events happen, Sulcus fires actions automatically. 6 event types, 7 actions, unlimited triggers per tenant.',
};

export default function TriggersPage() {
  return <TriggersClient />;
}
