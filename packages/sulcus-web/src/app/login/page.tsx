import type { Metadata } from 'next';
import LoginClient from './LoginClient';

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in or create a free account to start building AI agents with persistent thermodynamic memory.',
};

export default function LoginPage() {
  return <LoginClient />;
}
