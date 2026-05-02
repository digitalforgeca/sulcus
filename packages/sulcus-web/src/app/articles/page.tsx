import type { Metadata } from 'next';
import ArticlesClient from './ArticlesClient';

export const metadata: Metadata = {
  title: 'Articles',
  description: 'Sharp analysis of agent memory — what works, what doesn\'t, and where thermodynamics changes the equation.',
};

export default function ArticlesPage() {
  return <ArticlesClient />;
}
