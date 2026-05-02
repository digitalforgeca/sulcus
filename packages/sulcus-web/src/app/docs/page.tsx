import type { Metadata } from 'next';
import DocsClient from './DocsClient';

export const metadata: Metadata = {
  title: 'Documentation',
  description: 'Everything you need to give your AI agents persistent thermodynamic memory. SDKs, REST API, MCP integration, reactive triggers, and more.',
};

export default function DocsPage() {
  return <DocsClient />;
}
