'use client';

import { RiggerCanvas } from '@/components/rigger/RiggerCanvas';
import { RiggerSidebar } from '@/components/rigger/RiggerSidebar';

export function RiggerPage() {
  return (
    <div className="flex h-screen w-screen bg-zinc-950 overflow-hidden font-sans">
      {/* Left sidebar — fixed width */}
      <aside className="w-80 flex-shrink-0 h-full overflow-y-auto border-r border-zinc-800/80 bg-zinc-950">
        <RiggerSidebar />
      </aside>

      {/* 3D viewport — takes remaining space */}
      <main className="flex-1 h-full relative overflow-hidden">
        <RiggerCanvas />
      </main>
    </div>
  );
}
