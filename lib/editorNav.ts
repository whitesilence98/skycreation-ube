import { editorCategory, type EditorCategory } from '@/lib/faceControls';
import { CATEGORY_MAP } from '@/lib/manifestSelect';
import { useCharacter } from '@/lib/store';

/** Where Exit/Esc returns to. Outfit is a screen, not a category you exit into. */
let previous: EditorCategory = 'face';

/** Explicit navigation only; preserve remembered sub-tabs and framing outside Outfit. */
export function navigateCategory(id: EditorCategory): void {
  const state = useCharacter.getState;
  const category = editorCategory(state().primaryTab);
  if (id !== 'outfit') previous = id;
  state().endFaceCompare(); state().endFaceEdit();
  if (category === 'face' && id !== 'face') state().applyFaceBaseline();
  const tabs: Record<EditorCategory, string> = {
    preset: 'PRESET',
    face: 'FACE SHAPE',
    hair: 'HAIR',
    body: 'BODY',
    outfit: 'EQUIPMENT',
    styling: 'FACE',
  };
  state().setPrimaryTab(tabs[id]);
  state().setWorkspace('edit');
  if (id === 'face') state().applyFaceBaseline();
  if (id === 'body') {
    if (!state().bodyTab) state().setBodyTab('physique');
    state().setCameraFraming('body');
  }
  if (id === 'outfit' && !state().bodyTab) state().setBodyTab('gear');
  if (id === 'styling') {
    const kind = (state().subTab || 'skin').toLowerCase();
    state().setActiveCategory(Object.hasOwn(CATEGORY_MAP, kind) ? kind as keyof typeof CATEGORY_MAP : 'skin');
  }
  if (id === 'outfit' || !state().cameraFraming) state().setCameraFraming(id === 'face' ? 'face' : 'body');
}

export function exitWardrobe(): void {
  navigateCategory(previous);
}
