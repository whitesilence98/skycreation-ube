import { create } from 'zustand';
import type { HdrFormat } from '@/lib/hdr';

/** Raw HDR images are deliberately transient: no localStorage URLs or preset uploads. */
export const useHdr = create<{
  source: { name: string; format: HdrFormat; buffer: ArrayBuffer } | null;
  status: 'studio' | 'loading' | 'ready' | 'error';
  error: string | null;
  setSource: (source: { name: string; format: HdrFormat; buffer: ArrayBuffer } | null) => void;
}>(set => ({
  source: null, status: 'studio', error: null,
  setSource: source => set({ source, status: source ? 'loading' : 'studio', error: null }),
}));
