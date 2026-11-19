'use client';

import { useEffect, useRef, useState } from 'react';
import { TopBar } from '@/components/hud/TopBar';
import { LeftPanel } from '@/components/hud/LeftPanel';
import { Footer } from '@/components/hud/Footer';
import { CategoryRail } from '@/components/hud/shell/CategoryRail';
import { SubList } from '@/components/hud/shell/SubList';
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
import { GizmoTooltip } from '@/components/hud/GizmoTooltip';
import { editorCategory, CATEGORY_LABELS, type EditorCategory, type FaceSectionId } from '@/lib/faceControls';
import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { CATEGORY_MAP } from '@/lib/manifestSelect';

export function Hud({ manifest }: { manifest: Mo2Manifest | null }) {
  const primary = useCharacter(s => s.primaryTab);
  const workspace = useCharacter(s => s.workspace);
  const preview = useCharacter(s => s.previewMode);
  const compare = useCharacter(s => s.faceCompareStart !== null);
  const toast = useCharacter(s => s.toast);
  const category = editorCategory(primary);
  const [section, setSection] = useState<FaceSectionId>(() => useCharacter.getState().activeRegion);
  const [editorOpen, setEditorOpen] = useState(true);
  const tools = useRef<HTMLDivElement>(null);
  const toolTrigger = useRef<HTMLElement | null>(null);
  const previousTool = useRef(false);
  const state = useCharacter.getState;
  const toolOpen = !preview && !['edit', 'sculpt'].includes(workspace);

  const selectCategory = (id: EditorCategory) => {
    state().endFaceCompare(); state().endFaceEdit();
    if (category === 'face' && id !== 'face') state().applyFaceBaseline();
    const tabs = { preset: 'PRESET', face: 'FACE SHAPE', hair: 'HAIR', body: 'BODY', outfit: 'EQUIPMENT', styling: 'FACE' };
    state().setPrimaryTab(tabs[id]);
    state().setWorkspace('edit');
    if (id === 'face') state().applyFaceBaseline();
    if (id === 'body') state().setBodyTab('physique');
    if (id === 'outfit') state().setBodyTab('gear');
    if (id === 'styling') {
      const kind = state().subTab.toLowerCase();
      state().setActiveCategory(Object.hasOwn(CATEGORY_MAP, kind) ? kind as keyof typeof CATEGORY_MAP : 'skin');
    }
    setEditorOpen(true);
    // Explicit category selection only; never reframe on reload or while editing a slider.
    /* Every category frames the standing figure, matching the reference's
       full-body preview. FACE keeps the face framing because that is the only
       category whose controls act on the face at slider scale. */
    state().setCameraFraming(id === 'face' ? 'face' : 'body');
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
      if (event.key === 'Escape') {
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
  }, [category]);
  useEffect(() => { if (category === 'face') state().applyFaceBaseline(); }, [category]);

  return <div className="creator-shell pointer-events-none absolute inset-0 z-10">
    <TopBar manifest={manifest} />
    {!preview && <>
      <CategoryRail selected={category} onSelect={selectCategory} />
      <button type="button" className="creator-editor-toggle" aria-controls="creator-editor"
        aria-expanded={editorOpen && !toolOpen} hidden={toolOpen}
        onClick={() => setEditorOpen(v => !v)}>{editorOpen ? 'Hide panel' : 'Show panel'}</button>
      <aside id="creator-editor" className={`creator-editor ${category === 'face' ? 'creator-editor-face' : ''}`}
        aria-label={`${CATEGORY_LABELS[category]} editor`} hidden={!editorOpen || toolOpen} inert={compare}>
        {category === 'face' ? <><SubList selected={section} onSelect={setSection} /><ControlColumn section={section} /></>
          : <LeftPanel manifest={manifest} category={category} />}
      </aside>
      <ToolStrip />
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
      <Footer manifest={manifest} />
      <GizmoTooltip />
    </>}
    {toast && <div role="status" aria-live="polite" className="creator-toast">{toast}</div>}
  </div>;
}
