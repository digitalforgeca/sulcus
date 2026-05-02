import type { Metadata } from 'next';
import RegisterClient from './RegisterClient';

export const metadata: Metadata = {
  title: 'Create Account — Sulcus',
  description: 'Create your free Sulcus account. Persistent, reactive memory for AI agents.',
};

export default function RegisterPage() {
  return <RegisterClient />;
}
