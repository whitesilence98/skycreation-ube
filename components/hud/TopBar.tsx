'use client';

import { useCharacter, type StudioPage } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { WuxiaTopNavBar, type TopNavTab } from '@/components/hud/common/WuxiaTopNavBar';
import { WuxiaExportDropdown } from '@/components/hud/common/WuxiaExportDropdown';
import { WuxiaImportButton } from '@/components/hud/common/WuxiaImportButton';

function TopBarRightActions({ manifest }: { manifest: Mo2Manifest | null }) {
  const cameraLockMode = useCharacter((s) => s.cameraLockMode);
  const toggleCameraLockMode = useCharacter((s) => s.toggleCameraLockMode);
  const isCamLocked = cameraLockMode === 'locked';

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 select-none">
      <button
        type="button"
        onClick={toggleCameraLockMode}
        aria-pressed={isCamLocked}
        title={isCamLocked ? 'Tab Camera Lock ON — auto-frames & clamps per tab (click to unlock Free Cam)' : 'Free Cam ON — unrestricted 360° orbit (click to enable Tab Camera Lock)'}
        className={`pointer-events-auto h-7 min-h-[28px] px-2 sm:px-2.5 rounded-[2px] text-[10px] font-mono tracking-wider transition-all flex items-center gap-1 uppercase focus-visible:outline focus-visible:outline-[#eac87f] border ${
          isCamLocked
            ? 'text-[#f5ecd8] bg-[#dfba73]/20 border-[#dfba73]/70 shadow-[0_0_8px_rgba(223,186,115,0.22)]'
            : 'text-[#d9d2c5] bg-[#1e1f26]/80 hover:bg-[#282a34] border-white/15 hover:border-[#dfba73]/50'
        }`}
      >
        <span aria-hidden>{isCamLocked ? '🔒' : '🔓'}</span>
        <span className="hidden md:inline">{isCamLocked ? 'Cam Lock' : 'Free Cam'}</span>
      </button>
      <WuxiaImportButton manifest={manifest} />
      <WuxiaExportDropdown />
      <button
        type="button"
        onClick={() => window.location.assign('/')}
        title="Open 3D Room Builder & Tour"
        className="pointer-events-auto h-7 min-h-[28px] px-2 sm:px-2.5 rounded-[2px] text-[10px] font-mono tracking-widest text-[#f5ecd8] bg-[#dfba73]/18 hover:bg-[#dfba73]/30 border border-[#dfba73]/55 transition-all flex items-center gap-1.5 uppercase focus-visible:outline focus-visible:outline-[#eac87f] shadow-[0_0_8px_rgba(223,186,115,0.18)]"
      >
        <span aria-hidden>⌂</span>
        <span>Room</span>
      </button>
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

  const studioTabs: TopNavTab[] = [
    { id: 'default', label: isOutfit ? 'Wardrobe' : 'Customization' },
    { id: 'expressions', label: 'Expressions' },
    { id: 'ube_morphs', label: 'Morphs' },
    { id: 'sculpt', label: '3D Sculpt' },
    { id: 'head_base', label: 'Head & Base' },
    { id: 'body_paint', label: 'Body Paint' },
    ...(isHair || isMakeup ? [{ id: 'smart', label: 'Smart' }] : []),
  ];

  const validTab = studioTabs.some((t) => t.id === studioPage) ? studioPage : 'default';

  if (isPreset || isHair || isMakeup || isFace || isBody || isOutfit) {
    return (
      <WuxiaTopNavBar
        tabs={studioTabs}
        activeTab={validTab}
        onTabChange={(tabId) => {
          useCharacter.getState().setStudioPage(tabId as StudioPage);
        }}
        isCollapsed={preview}
        onToggleCollapse={() => setPreviewMode(!preview)}
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
