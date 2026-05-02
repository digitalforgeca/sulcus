import type { Metadata } from 'next';
import ThermodynamicEngineClient from './ThermodynamicEngineClient';

export const metadata: Metadata = {
  title: 'Thermodynamic Engine',
  description: 'Deep dive into the Sulcus thermodynamic engine: decay formula, resonance, consolidation, active index, and recall quality analytics.',
};

export default function ThermodynamicEnginePage() {
  return <ThermodynamicEngineClient />;
}
