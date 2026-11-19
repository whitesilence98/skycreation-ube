'use client';

import { useCharacter } from '@/lib/store';
import { PresetPanel } from '@/components/hud/PresetPanel';
import { HairStyles } from '@/components/hud/HairStyles';
import { HairProperties } from '@/components/hud/HairProperties';
import { BodyPanel } from '@/components/hud/BodyPanel';
import { BodyProperties } from '@/components/hud/BodyProperties';
import { EquipmentPanel } from '@/components/hud/EquipmentPanel';
import { WardrobeDrawer } from '@/components/hud/WardrobeDrawer';
import { SkinPicker } from '@/components/hud/SkinPicker';
import { SkinProperties } from '@/components/hud/SkinProperties';
import { EyePicker } from '@/components/hud/EyePicker';
import { BrowsPicker } from '@/components/hud/BrowsPicker';
import { BrowProperties } from '@/components/hud/BrowProperties';
import { MakeupPicker } from '@/components/hud/MakeupPicker';
import { MakeupProperties } from '@/components/hud/MakeupProperties';
import { LashesPicker } from '@/components/hud/LashesPicker';
import { LashesProperties } from '@/components/hud/LashesProperties';
import { MouthPicker } from '@/components/hud/MouthPicker';
import { TattooPicker } from '@/components/hud/TattooPicker';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import type { EditorCategory } from '@/lib/faceControls';
import type { UiCategory } from '@/lib/manifestSelect';

const STYLE_TABS = [
  ['SKIN', 'Skin', 'skin'], ['EYES', 'Eyes', 'eyes'], ['BROWS', 'Brows', 'brows'],
  ['MAKEUP', 'Makeup', 'makeup'], ['LASHES', 'Lashes', 'lashes'], ['MOUTH', 'Mouth', 'mouth'],
  ['TATTOO', 'Tattoos', 'tattoo'],
] as const;
export function LeftPanel({ manifest, category }: { manifest: Mo2Manifest | null; category: EditorCategory }) {
  const subTab = useCharacter(s => s.subTab);
  const state = useCharacter.getState;
  return <div className="creator-library">
    {category === 'preset' && <PresetPanel manifest={manifest} />}
    {category === 'hair' && <>
      <HairStyles manifest={manifest} />
      <details className="creator-details"><summary>Color &amp; finish</summary><HairProperties /></details>
    </>}
    {category === 'body' && <>
      <BodyPanel manifest={manifest} />
      <details className="creator-details"><summary>Physics &amp; pose properties</summary><BodyProperties manifest={manifest} /></details>
    </>}
    {category === 'outfit' && <>
      <EquipmentPanel manifest={manifest} />
      <details className="creator-details"><summary>Browse all garments</summary><WardrobeDrawer manifest={manifest} onClose={() => state().setWorkspace('edit')} /></details>
    </>}
    {category === 'styling' && <>
      <nav className="creator-style-tabs" aria-label="Appearance categories">
        {STYLE_TABS.map(([id, label, kind]) => <button key={id} type="button" aria-pressed={subTab === id}
          onClick={() => { state().setSubTab(id); state().setActiveCategory(kind as UiCategory); }}>
          {label}
        </button>)}
      </nav>
      {/* Every FACE style tab is explicit now; the generic AssetPanel fallback is
          gone (AssetPanel itself remains for the dormant ASSETS workspace). */}
      {subTab === 'SKIN' ? <><SkinPicker manifest={manifest} /><details className="creator-details"><summary>Color &amp; finish</summary><SkinProperties /></details></>
        : subTab === 'EYES' ? <EyePicker manifest={manifest} />
          : subTab === 'BROWS' ? <><BrowsPicker manifest={manifest} /><details className="creator-details"><summary>Color &amp; finish</summary><BrowProperties /></details></>
            : subTab === 'MAKEUP' ? <><MakeupPicker /><details className="creator-details"><summary>Selected layer properties</summary><MakeupProperties /></details></>
              : subTab === 'LASHES' ? <><LashesPicker /><details className="creator-details"><summary>Color &amp; finish</summary><LashesProperties /></details></>
                : subTab === 'MOUTH' ? <MouthPicker />
                  : subTab === 'TATTOO' ? <><TattooPicker /><details className="creator-details"><summary>Selected layer properties</summary><MakeupProperties kind="tattoo" /></details></>
                    : <><SkinPicker manifest={manifest} /><details className="creator-details"><summary>Color &amp; finish</summary><SkinProperties /></details></>}
    </>}
  </div>;
}
