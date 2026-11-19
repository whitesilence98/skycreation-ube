import { presetFileName, type PresetFile } from '@/lib/presetIO';

/**
 * Downloads a preset as JSON using the same Blob + anchor flow as the footer
 * exporter. The URL is revoked after the browser has had time to start the
 * download.
 */
export function downloadPresetJson(file: PresetFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = presetFileName(file.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
