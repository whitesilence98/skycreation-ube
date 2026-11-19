'use client';

import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

/**
 * The reference header is a single line of chrome: a small figure glyph, the
 * screen name, and a collapse control at the far right. It carries no name
 * field or action button, so neither does this.
 */
export function TopBar({ manifest: _manifest }: { manifest: Mo2Manifest | null }) {
  const name = useCharacter(s => s.name);
  const preview = useCharacter(s => s.previewMode);
  return <header className="creator-header">
    <div className="creator-header-title">
      <svg viewBox="0 0 24 24" className="creator-header-glyph" aria-hidden>
        <circle cx="12" cy="7.4" r="3.3" fill="currentColor" />
        <path d="M12 11.6c-3.6 0-6.2 2.2-6.6 6.2h13.2c-.4-4-3-6.2-6.6-6.2z" fill="currentColor" />
      </svg>
      <span className="creator-header-name">{preview ? name : 'Preview'}</span>
      <a
        href="/rigger"
        target="_blank"
        rel="noreferrer"
        className="ml-4 px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-800/80 hover:bg-zinc-700 text-sky-400 border border-zinc-700/60 transition-colors flex items-center gap-1.5 no-underline"
        title="Open Auto-Rigger Studio"
      >
        <span>🦴</span> Auto-Rigger
      </a>
    </div>
    <button type="button" className="creator-header-collapse" onClick={() => useCharacter.getState().setPreviewMode(!preview)}
      aria-pressed={preview} title={preview ? 'Return to editor' : 'Preview without panels'}>
      <span>{preview ? 'Edit' : 'Preview'}</span>
      <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" aria-hidden>
        <path d="M13.5 12 6 4.5 8.2 2.3 18 12l-9.8 9.7L6 19.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </button>
  </header>;
}
