'use client';

import React from 'react';
import { usePresetImport } from '@/components/hud/usePresetImport';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

function IconImport({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className} aria-hidden>
      <path d="M6 1v6" stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" />
      <path d="M3.6 4.4 6 6.8l2.4-2.4" stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 8.6v1.2a.8.8 0 0 0 .8.8h6.4a.8.8 0 0 0 .8-.8V8.6" stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Top-bar preset importer button matching WuxiaExportDropdown styling.
 * Accepts LYRA `.json`, RaceMenu `.jslot`, and MO2 `.nif` meshes.
 */
export function WuxiaImportButton({ manifest }: { manifest: Mo2Manifest | null }) {
  const { inputRef, importing, openFilePicker, onFileChange } = usePresetImport(manifest);

  return (
    <div className="pointer-events-auto">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".json,.jslot,.nif"
        onChange={onFileChange}
        className="hidden"
        aria-label="Import preset file"
      />
      <button
        type="button"
        onClick={openFilePicker}
        disabled={importing}
        title="Import character preset (.json, .jslot) or MO2 head (.nif)"
        className={cn(
          'group flex h-7 items-center gap-1.5 rounded-[2px] border px-2.5 text-[10px] font-mono tracking-widest uppercase transition-all duration-150',
          'border-[#dfba73]/35 bg-[#1b1916]/80 text-[#dfba73] hover:border-[#dfba73]/70 hover:bg-[#dfba73]/15 hover:text-white',
          importing && 'opacity-60 cursor-wait',
        )}
      >
        {importing ? (
          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-t-transparent border-[#dfba73]" />
        ) : (
          <IconImport className="h-3 w-3 text-[#dfba73] transition-transform duration-150 group-hover:translate-y-[1px] group-hover:text-white" />
        )}
        <span>{importing ? 'IMPORTING...' : 'IMPORT'}</span>
      </button>
    </div>
  );
}
