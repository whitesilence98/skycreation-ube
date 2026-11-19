import type { Metadata } from 'next';
import { RiggerPage } from '@/components/rigger/RiggerPage';

export const metadata: Metadata = {
  title: 'Auto-Rigger Studio — CC-Kit',
  description: 'Automated VRM 1.0 humanoid skeleton fitting, weight painting and GLB export in browser.',
};

export default function Page() {
  return <RiggerPage />;
}
