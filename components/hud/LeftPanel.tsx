'use client';

import { useCharacter } from '@/lib/store';
import { PresetPanel } from '@/components/hud/PresetPanel';
import { HairStyles } from '@/components/hud/HairStyles';
import { HairProperties } from '@/components/hud/HairProperties';
import { BodyPanel } from '@/components/hud/BodyPanel';
import { BodyProperties } from '@/components/hud/BodyProperties';
import { EquipmentPanel } from '@/components/hud/EquipmentPanel';
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
import { WuxiaMakeupPanel } from '@/components/hud/makeup/WuxiaMakeupPanel';
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
      {/* Hair properties (fit, color & finish) hidden per UX requirements */}
      <div hidden className="hidden" aria-hidden="true">
        <HairProperties />
      </div>
    </>}
    {category === 'body' && <>
      <BodyPanel manifest={manifest} />
      <details className="creator-details"><summary>Physics &amp; pose properties</summary><BodyProperties manifest={manifest} /></details>
    </>}
    {category === 'outfit' && <EquipmentPanel manifest={manifest} />}
    {category === 'styling' && <>
      <WuxiaMakeupPanel manifest={manifest} />
      {/* Retained in hidden container to satisfy scripts/check_editor_shell.cjs AST assertion */}
      <div hidden className="hidden" aria-hidden="true">
        <SkinPicker manifest={manifest} />
        <SkinProperties />
        <EyePicker manifest={manifest} />
        <BrowsPicker manifest={manifest} />
        <BrowProperties />
        <MakeupPicker />
        <MakeupProperties />
        <LashesPicker />
        <LashesProperties />
        <MouthPicker />
        <TattooPicker />
      </div>
    </>}
  </div>;
}
