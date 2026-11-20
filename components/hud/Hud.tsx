'use client';

import { useEffect, useRef, useState } from 'react';
import { TopBar } from '@/components/hud/TopBar';
import { LeftPanel } from '@/components/hud/LeftPanel';
import { Footer } from '@/components/hud/Footer';
import { CategoryRail } from '@/components/hud/shell/CategoryRail';
import { SubList } from '@/components/hud/shell/SubList';
import { RegionStrip, ControlsDisclosure } from '@/components/hud/shell/RegionStrip';
import { ControlColumn } from '@/components/hud/shell/ControlColumn';
import { ToolStrip } from '@/components/hud/shell/ToolStrip';
import { HdrPanel } from '@/components/hud/HdrPanel';
import { CameraPanel } from '@/components/hud/CameraPanel';
import { GraphicsPanel } from '@/components/hud/GraphicsPanel';
import { PosePanel } from '@/components/hud/PosePanel';
import { SettingsPanel } from '@/components/hud/SettingsPanel';
import { BodyProperties } from '@/components/hud/BodyProperties';
import { AssetPanel } from '@/components/hud/AssetPanel';
import { WardrobeDrawer } from '@/components/hud/WardrobeDrawer';
import { OutfitSideActions } from '@/components/hud/outfit/OutfitSideActions';
import { ImportCustomizationDrawer } from '@/components/hud/common/ImportCustomizationDrawer';
import { GizmoTooltip } from '@/components/hud/GizmoTooltip';
import { editorCategory, CATEGORY_LABELS, type EditorCategory, type FaceSectionId } from '@/lib/faceControls';
import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { exitWardrobe, navigateCategory } from '@/lib/editorNav';

export function Hud({ manifest }: { manifest: Mo2Manifest | null }) {
  const primary = useCharacter(s => s.primaryTab);
  const workspace = useCharacter(s => s.workspace);
  const preview = useCharacter(s => s.previewMode);
  const compare = useCharacter(s => s.faceCompareStart !== null);
  const toast = useCharacter(s => s.toast);
  const category = editorCategory(primary);
  const [section, setSection] = useState<FaceSectionId>(() => useCharacter.getState().activeRegion);
  const [editorOpen, setEditorOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);
  const tools = useRef<HTMLDivElement>(null);
  const toolTrigger = useRef<HTMLElement | null>(null);
  const previousTool = useRef(false);
  const state = useCharacter.getState;
  const toolOpen = !preview && !['edit', 'sculpt'].includes(workspace);
  const editorHidden = category === 'outfit' ? (toolOpen && isMobile) : (!editorOpen || (toolOpen && isMobile));

  useEffect(() => {
    const mql = window.matchMedia(category === 'outfit' ? '(max-width: 900px)' : '(max-width: 760px)');
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [category]);

  const selectCategory = (id: EditorCategory) => {
    navigateCategory(id);
    setEditorOpen(true);
  };
  const closeTool = () => state().setWorkspace('edit');
  useEffect(() => {
    if (toolOpen) {
      /* Focus the drawer container itself (tabIndex -1), never its first
         control: in CameraPanel that is the destructive RESET, so a keyboard
         user pressing Enter on arrival would wipe their framing before
         reading the panel title. */
      if (!previousTool.current) toolTrigger.current = document.activeElement as HTMLElement;
      tools.current?.focus({ preventScroll: true });
    } else if (previousTool.current && toolTrigger.current?.isConnected) toolTrigger.current.focus({ preventScroll: true });
    previousTool.current = toolOpen;
  }, [toolOpen, workspace]);
  useEffect(() => {
    const release = () => { state().endFaceCompare(); state().endFaceEdit(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        // Native dialog cancellation owns Escape; never close the drawer beneath it.
        if (document.querySelector('dialog[open], [role="menu"]')) return;
        const menus = document.querySelectorAll<HTMLDetailsElement>('details[open]:has(> summary)');
        const menu = Array.from(menus).reverse().find(e => e.querySelector('[role="group"], [role="menu"]') || e.closest('.creator-wardrobe-sets, .creator-outfit-more'));
        if (menu) {
          menu.open = false; menu.querySelector<HTMLElement>('summary')?.focus();
          event.preventDefault(); event.stopPropagation(); return;
        }
        if (category === 'outfit') {
          if (state().previewMode) { release(); state().setPreviewMode(false); return; }
          if (toolOpen) { release(); closeTool(); return; }
          release(); exitWardrobe(); return;
        }
        release(); state().setPreviewMode(false); closeTool();
      }
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (category === 'face' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) state().redoFace(); else state().undoFace();
      }
    };
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release); document.addEventListener('keydown', onKey);
    return () => {
      release(); window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release); document.removeEventListener('keydown', onKey);
    };
  }, [category, toolOpen]);
  useEffect(() => { if (category === 'face') state().applyFaceBaseline(); }, [category]);

  const isWuxiaFloating = category === 'outfit' || category === 'hair';

  return <div className="creator-shell pointer-events-none absolute inset-0 z-10" data-outfit={category === 'outfit' ? 'true' : undefined} data-hair={category === 'hair' ? 'true' : undefined}>
    <TopBar manifest={manifest} />
    {!preview && <>
      {!isWuxiaFloating && <CategoryRail selected={category} onSelect={selectCategory} />}
      {!isWuxiaFloating && <button type="button" className="creator-editor-toggle" aria-controls="creator-editor"
        aria-expanded={editorOpen && (!isMobile || !toolOpen)} hidden={isMobile && toolOpen}
        onClick={() => setEditorOpen(v => !v)}>{editorOpen ? 'Hide panel' : 'Show panel'}</button>}
      <aside id="creator-editor" className={`creator-editor ${category === 'face' ? 'creator-editor-face' : category === 'outfit' ? 'creator-editor-outfit' : ''}`}
        aria-label={`${CATEGORY_LABELS[category]} editor`} hidden={editorHidden} inert={compare}>
        {category === 'face' ? <>
          <RegionStrip selected={section} onSelect={setSection} />
          <ControlsDisclosure><ControlColumn section={section} /></ControlsDisclosure>
        </> : <LeftPanel manifest={manifest} category={category} />}
      </aside>
      {category === 'outfit' && <OutfitSideActions />}
      {category === 'hair' && <ImportCustomizationDrawer isOpen={importDrawerOpen} onClose={() => setImportDrawerOpen(false)} />}
      {!isWuxiaFloating && <ToolStrip />}
      {toolOpen && <aside ref={tools} className="creator-tool-drawer" aria-label="Studio properties" tabIndex={-1}>
        {workspace === 'camera' && <CameraPanel onClose={closeTool} />}
        {workspace === 'hdr' && <HdrPanel onClose={closeTool} />}
        {workspace === 'graphics' && <GraphicsPanel onClose={closeTool} />}
        {workspace === 'poses' && <PosePanel onClose={closeTool} />}
        {workspace === 'settings' && <SettingsPanel onClose={closeTool} />}
        {workspace === 'physics' && <BodyProperties manifest={manifest} onClose={closeTool} />}
        {workspace === 'assets' && <AssetPanel manifest={manifest} active onClose={closeTool} />}
        {workspace === 'wardrobe' && <WardrobeDrawer manifest={manifest} onClose={closeTool} />}
      </aside>}
      <Footer manifest={manifest} onToggleCustomizationDrawer={() => setImportDrawerOpen(v => !v)} />
      <GizmoTooltip />
    </>}
    {toast && <div role="status" aria-live="polite" className="creator-toast">{toast}</div>}
  </div>;
}
