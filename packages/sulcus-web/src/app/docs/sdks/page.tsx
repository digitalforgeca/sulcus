import type { Metadata } from 'next';
import SdksClient from './SdksClient';

export const metadata: Metadata = {
  title: 'SDKs & Integrations',
  description: 'Open-source SDKs for Python, Node.js, LangChain, LlamaIndex, CrewAI, Vercel AI SDK, and more. Connect any AI framework to Sulcus thermodynamic memory.',
};

export default function SdksPage() {
  return <SdksClient />;
}
