'use client';

import { useCharacter, type Workspace } from '@/lib/store';
import { IconCamera, IconGear, IconPose, IconEye, IconFocus } from '@/components/hud/Icons';

const TOOLS = [
  { id: 'camera', label: 'Camera', Icon: IconCamera },
  { id: 'hdr', label: 'Lighting', Icon: IconFocus },
  { id: 'poses', label: 'Poses', Icon: IconPose },
  { id: 'graphics', label: 'Graphics', Icon: IconEye },
  { id: 'settings', label: 'Settings', Icon: IconGear },
] as const;

/**
 * Right edge of the reference: a stack of round icon buttons pinned to the
 * lower half, each one a bare glyph with no visible label until hover.
 */
export function ToolStrip() {
  const workspace = useCharacter(s => s.workspace);
  const setWorkspace = useCharacter(s => s.setWorkspace);
  return <nav aria-label="Studio tools" className="creator-tools">
    {TOOLS.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={workspace === id}
      aria-label={label} title={label} onClick={() => setWorkspace(workspace === id ? 'edit' : id as Workspace)}>
      <Icon className="h-[18px] w-[18px]" />
    </button>)}
  </nav>;
}
