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
export function ToolStrip() {
  const workspace = useCharacter(s => s.workspace);
  const setWorkspace = useCharacter(s => s.setWorkspace);
  return <nav aria-label="Studio tools" className="creator-tools">
    {TOOLS.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={workspace === id}
      aria-label={label} title={label} onClick={() => setWorkspace(workspace === id ? 'edit' : id as Workspace)}>
      <Icon className="h-5 w-5" /><span>{label}</span>
    </button>)}
  </nav>;
}
