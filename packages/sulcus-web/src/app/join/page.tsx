import type { Metadata } from 'next';
import JoinClient from './JoinClient';

export const metadata: Metadata = {
  title: 'Accept Invitation — Sulcus',
  description: 'Accept your invitation to join a Sulcus workspace.',
};

export default function JoinPage() {
  return <JoinClient />;
}
