type SaveHandler = () => void;
let handler: SaveHandler | undefined;
const listeners = new Set<() => void>();

export function registerOutfitSaveHandler(save: SaveHandler): void { handler = save; }
export function unregisterOutfitSaveHandler(save: SaveHandler): void {
  if (handler === save) handler = undefined;
}
export function requestOutfitSave(): boolean {
  if (!handler) return false;
  try { handler(); return true; } catch { return false; }
}
export function notifyOutfitsChanged(): void {
  for (const listener of listeners) {
    try { listener(); } catch { /* A stale panel must not prevent another panel refreshing. */ }
  }
}
export function subscribeOutfitsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
