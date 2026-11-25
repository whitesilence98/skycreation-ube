'use client';

import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { WuxiaTopNavBar } from '@/components/hud/common/WuxiaTopNavBar';
import { WuxiaExportDropdown } from '@/components/hud/common/WuxiaExportDropdown';
import { WuxiaImportButton } from '@/components/hud/common/WuxiaImportButton';

function TopBarRightActions({ manifest }: { manifest: Mo2Manifest | null }) {
  const blinkPreview = useCharacter((s) => s.blinkPreview);
  const setBlinkPreview = useCharacter((s) => s.setBlinkPreview);
  const triggerBlink = useCharacter((s) => s.triggerBlink);
  const facialExpressions = useCharacter((s) => s.facialExpressions);
  const setFacialExpressions = useCharacter((s) => s.setFacialExpressions);
  const isClosedHeld = blinkPreview !== null;
  const isSmiling = (facialExpressions.smile ?? 0) > 0 || (facialExpressions.smallSmile ?? 0) > 0;

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 select-none">
      <button
        type="button"
        onClick={() => setFacialExpressions(isSmiling ? {} : { smile: 0.85 })}
        aria-pressed={isSmiling}
        title="Preview smooth anatomical Duchenne smile"
        className={`pointer-events-auto h-7 px-2 sm:px-2.5 rounded-[2px] text-[10px] font-mono tracking-wider transition-all flex items-center gap-1 uppercase focus-visible:outline focus-visible:outline-[#eac87f] border ${
          isSmiling
            ? 'text-[#f5ecd8] bg-[#dfba73]/25 border-[#dfba73] shadow-[0_0_10px_rgba(223,186,115,0.3)]'
            : 'text-[#d9d2c5] bg-[#1e1f26]/80 hover:bg-[#282a34] border-white/15 hover:border-[#dfba73]/50'
        }`}
      >
        Smile
      </button>
      <button
        type="button"
        onClick={triggerBlink}
        title="Play one natural eye blink"
        className="pointer-events-auto h-7 px-2 sm:px-2.5 rounded-[2px] text-[10px] font-mono tracking-wider text-[#d9d2c5] bg-[#1e1f26]/80 hover:bg-[#282a34] border border-white/15 hover:border-[#dfba73]/50 transition-all flex items-center gap-1 uppercase focus-visible:outline focus-visible:outline-[#eac87f]"
      >
        Blink
      </button>
      <button
        type="button"
        onClick={() => setBlinkPreview(isClosedHeld ? null : 1)}
        aria-pressed={isClosedHeld}
        title="Hold eyes closed to inspect eyelid seam, shading, and lashes"
        className={`pointer-events-auto h-7 px-2 sm:px-2.5 rounded-[2px] text-[10px] font-mono tracking-wider transition-all flex items-center gap-1 uppercase focus-visible:outline focus-visible:outline-[#eac87f] border ${
          isClosedHeld
            ? 'text-[#f5ecd8] bg-[#dfba73]/25 border-[#dfba73] shadow-[0_0_10px_rgba(223,186,115,0.3)]'
            : 'text-[#d9d2c5] bg-[#1e1f26]/80 hover:bg-[#282a34] border-white/15 hover:border-[#dfba73]/50'
        }`}
      >
        {isClosedHeld ? 'Open Eyes' : 'Hold Closed'}
      </button>
      <WuxiaImportButton manifest={manifest} />
      <WuxiaExportDropdown />
      <a
        href="/rigger"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Auto-Rigger Studio (opens in a new tab)"
        title="Auto-Rigger Studio (opens in a new tab)"
        className="pointer-events-auto h-7 px-2 sm:px-2.5 rounded-[2px] text-[10px] font-mono tracking-widest text-[#dfba73] bg-[#dfba73]/10 hover:bg-[#dfba73]/20 border border-[#dfba73]/30 transition-all flex items-center gap-1.5 uppercase"
      >
        <span>⚡</span>
        <span className="hidden xl:inline">Auto-Rigger</span>
      </a>
    </div>
  );
}

export function TopBar({ manifest }: { manifest: Mo2Manifest | null }) {
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

  // If in Preset mode:
  if (isPreset) {
    return (
      <WuxiaTopNavBar
        tabs={[
          { id: 'customization', label: 'Customization' },
          { id: 'makeup', label: 'Makeup' },
        ]}
        activeTab="customization"
        onTabChange={(tabId) => {
          if (tabId === 'makeup') {
            useCharacter.getState().setPrimaryTab('FACE');
          } else {
            useCharacter.getState().setPrimaryTab('PRESET');
          }
        }}
        isCollapsed={preview}
        onToggleCollapse={() => setPreviewMode(!preview)}
        rightSlot={<TopBarRightActions manifest={manifest} />}
      />
    );
  }

  // If in Hairstyle, Makeup, Features, or Physique mode:
  if (isHair || isMakeup || isFace || isBody) {
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
        rightSlot={<TopBarRightActions manifest={manifest} />}
      />
    );
  }

  // If in Wardrobe mode:
  if (isOutfit) {
    return (
      <WuxiaTopNavBar
        isCollapsed={preview}
        onToggleCollapse={() => setPreviewMode(!preview)}
        onTabChange={(tabId) => {
          if (tabId === 'backgrounds') {
            useCharacter.getState().setWorkspace('camera');
          } else if (tabId === 'weapon') {
            showToast('Weapon slots selected');
          } else {
            showToast(`Category switched: ${tabId}`);
          }
        }}
        rightSlot={<TopBarRightActions manifest={manifest} />}
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
      </div>
      <div className="flex items-center gap-2">
        <TopBarRightActions manifest={manifest} />
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
      </div>
    </header>
  );
}
