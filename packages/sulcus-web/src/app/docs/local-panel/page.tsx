import type { Metadata } from 'next';
import LocalPanelClient from './LocalPanelClient';

export const metadata: Metadata = {
  title: 'Local Control Panel',
  description: 'Browse nodes, inspect context, manage triggers, and tune thermodynamic settings with the Sulcus local control panel at localhost:4203.',
};

export default function LocalPanelPage() {
  return <LocalPanelClient />;
}
