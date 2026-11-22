'use client';

import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { WuxiaTopNavBar } from '@/components/hud/common/WuxiaTopNavBar';

export function TopBar({ manifest: _manifest }: { manifest: Mo2Manifest | null }) {
  const name = useCharacter((s) => s.name);
  const preview = useCharacter((s) => s.previewMode);
  const primaryTab = useCharacter((s) => s.primaryTab);
  const isOutfit = primaryTab === 'EQUIPMENT';
  const isHair = primaryTab === 'HAIR';
  const isMakeup = primaryTab === 'FACE';
  const isFace = primaryTab === 'FACE SHAPE';
  const isBody = primaryTab === 'BODY';
  const isPreset = primaryTab === 'PRESET';
  const studioPage = useCharacter((s) => s.studioPage);
  const setPreviewMode = useCharacter((s) => s.setPreviewMode);
  const showToast = useCharacter((s) => s.showToast);

  // If in Hairstyle, Makeup, Features, Physique, or Preset mode:
  if (isHair || isMakeup || isFace || isBody || isPreset) {
    const hasSmart = isHair || isMakeup;
    return (
      <WuxiaTopNavBar
        tabs={
          hasSmart
            ? [
                { id: 'customization', label: 'Customization' },
                { id: 'smart_customization', label: 'Smart Customization' },
              ]
            : [{ id: 'customization', label: 'Customization' }]
        }
        activeTab={hasSmart && studioPage === 'smart' ? 'smart_customization' : 'customization'}
        onTabChange={(tabId) =>
          useCharacter
            .getState()
            .setStudioPage(tabId === 'smart_customization' ? 'smart' : 'default')}
        isCollapsed={preview}
        onToggleCollapse={() => setPreviewMode(!preview)}
        onSearch={() =>
          showToast(
            isMakeup
              ? 'Search makeup styles (Q)'
              : isHair
                ? 'Search hairstyles (Q)'
                : isFace
                  ? 'Search facial features (Q)'
                  : isBody
                    ? 'Search body morphs (Q)'
                    : 'Search presets (Q)'
          )}
        rightSlot={
          <a
            href="/rigger"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Auto-Rigger Studio (opens in a new tab)"
            className="pointer-events-auto ml-2 px-2.5 py-0.5 rounded-[2px] text-[10px] font-mono tracking-widest text-[#d4b483] bg-[#d4b483]/10 hover:bg-[#d4b483]/20 border border-[#d4b483]/30 transition-all flex items-center gap-1.5 uppercase"
          >
            <span>⚡</span> Auto-Rigger
          </a>
        }
      />
    );
  }

  // If in Wardrobe mode, render the reusable Wuxia Top Navigation Bar
  if (isOutfit) {
    return (
      <WuxiaTopNavBar
        isCollapsed={preview}
        onToggleCollapse={() => setPreviewMode(!preview)}
        onSearch={() => showToast('Search item or slot (Q)')}
        onTabChange={(tabId) => {
          if (tabId === 'backgrounds') {
            useCharacter.getState().setWorkspace('camera');
          } else if (tabId === 'weapon') {
            showToast('Weapon slots selected');
          } else {
            showToast(`Category switched: ${tabId}`);
          }
        }}
      />
    );
  }

  // Default Header fallback
  return (
    <header className="creator-header">
      <div className="creator-header-title">
        <svg viewBox="0 0 24 24" className="creator-header-glyph" aria-hidden>
          <circle cx="12" cy="7.4" r="3.3" fill="currentColor" />
          <path d="M12 11.6c-3.6 0-6.2 2.2-6.6 6.2h13.2c-.4-4-3-6.2-6.6-6.2z" fill="currentColor" />
        </svg>
        <span className="creator-header-name font-display tracking-[0.16em] uppercase text-[#f2ecd9]">
          {name || 'Character Creator'}
        </span>
        <span className="creator-header-caption">{preview ? 'Preview Mode' : 'Sculpting Mode'}</span>
        <a
          href="/rigger"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Auto-Rigger Studio (opens in a new tab)"
          className="ml-4 px-2.5 py-0.5 rounded-[2px] text-[10px] font-mono tracking-widest text-[#d4b483] bg-[#d4b483]/10 hover:bg-[#d4b483]/20 border border-[#d4b483]/30 transition-all flex items-center gap-1.5 uppercase"
        >
          <span>⚡</span> Auto-Rigger
        </a>
      </div>
      <button
        type="button"
        className="creator-header-collapse"
        onClick={() => setPreviewMode(!preview)}
        aria-pressed={preview}
        title={preview ? 'Return to editor' : 'Preview without panels'}
      >
        <span>{preview ? 'Edit' : 'Preview'}</span>
        <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" aria-hidden>
          <path d="M13.5 12 6 4.5 8.2 2.3 18 12l-9.8 9.7L6 19.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </button>
    </header>
  );
}
