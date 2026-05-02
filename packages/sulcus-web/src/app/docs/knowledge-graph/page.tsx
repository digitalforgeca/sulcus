import type { Metadata } from 'next';
import KnowledgeGraphClient from './KnowledgeGraphClient';

export const metadata: Metadata = {
  title: 'Knowledge Graph (AGE)',
  description: 'Apache AGE temporal knowledge graph — memories as vertices, relationships as edges. Cypher queries, entity extraction via SILU, temporal traversal, and self-healing graph writes on every store and recall.',
};

export default function KnowledgeGraphPage() {
  return <KnowledgeGraphClient />;
}
