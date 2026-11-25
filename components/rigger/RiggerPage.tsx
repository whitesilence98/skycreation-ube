'use client';

import { useRiggerStore } from '@/lib/rigger/store';
import { RiggerCanvas } from '@/components/rigger/RiggerCanvas';
import { RiggerSidebar } from '@/components/rigger/RiggerSidebar';

export function RiggerPage() {
  const uiPhase = useRiggerStore((s) => s.uiPhase);
  const showSidebar = uiPhase !== 'preview';

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen bg-zinc-950 overflow-hidden font-sans">
      {/* Left sidebar — shown in Rig (Phase 1) and Export (Phase 3), collapsed in Preview (Phase 2) */}
      {showSidebar && (
        <aside className="w-full md:w-80 flex-shrink-0 max-h-[52vh] md:max-h-none md:h-full overflow-y-auto scrollbar-none border-b md:border-b-0 md:border-r border-zinc-800/80 bg-zinc-950">
          <RiggerSidebar />
        </aside>
      )}

      {/* 3D viewport — takes remaining space (100% full screen in Preview mode) */}
      <main className="flex-1 h-full relative overflow-hidden">
        <RiggerCanvas />
      </main>
    </div>
  );
}
