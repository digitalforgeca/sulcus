import type { Metadata } from 'next';
import TrainingClient from './TrainingClient';

export const metadata: Metadata = {
  title: 'Training Signals',
  description: 'Every memory lifecycle action generates training data for the SIU. Store, delete, reclassify, pin, and boost — each action teaches the quality gate and type classifier to improve over time.',
};

export default function TrainingPage() {
  return <TrainingClient />;
}
