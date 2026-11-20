'use client';

import { useState, useEffect } from 'react';
import { useCharacter } from '@/lib/store';
import { IconDoubleChevron } from '@/components/hud/outfit/WuxiaSlotIcons';

export interface ImportCustomizationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ImportCustomizationDrawer({ isOpen, onClose }: ImportCustomizationDrawerProps) {
  const showToast = useCharacter(s => s.showToast);
  const [code, setCode] = useState('ARTaRiBmXFg6ipeQfyA');

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(code).catch(() => {});
      showToast('Customization code copied to clipboard');
    }
  };

  const handleClear = () => {
    setCode('');
  };

  return (
    <aside
      role="dialog"
      aria-modal="true"
      className="pointer-events-auto absolute right-0 top-0 bottom-0 z-30 flex w-full sm:w-[304px] flex-col border-l border-white/10 bg-[#16171b]/95 p-6 text-[#e6e1d8] shadow-2xl backdrop-blur-xl select-none"
      aria-label="Import Customization Data"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-6">
        <h2 className="text-base font-normal tracking-wide text-[#e6e1d8]">
          Import Customization Data
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close drawer"
          title="Close (Esc)"
          className="flex h-7 w-7 items-center justify-center rounded-[2px] text-[#93828c] transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
        >
          <IconDoubleChevron className="h-4 w-4 rotate-180" />
        </button>
      </div>

      {/* QR Code Upload Card */}
      <div className="mb-6">
        <button
          type="button"
          onClick={() => showToast('Select an image with a QR code to import')}
          aria-label="Add image with QR code"
          className="group relative flex h-36 w-full flex-col items-center justify-center rounded-[2px] border border-white/10 bg-[#1e2025]/80 p-4 transition-all hover:border-[#d4b483]/50 hover:bg-[#25272e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
        >
          {/* Subtle patterned background overlay */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.04)_0%,transparent_70%)] pointer-events-none" />

          {/* Plus icon */}
          <span className="flex h-10 w-10 items-center justify-center text-3xl font-light text-[#cfcacf] transition-transform group-hover:scale-110 group-hover:text-white">
            +
          </span>
          <span className="mt-2 text-xs font-normal tracking-wide text-[#9f9da6] group-hover:text-[#e6e1d8]">
            Add Image with QR Code
          </span>
        </button>
      </div>

      {/* Customization Code Field */}
      <div className="flex flex-col gap-2">
        <label htmlFor="customization-code-input" className="text-xs font-normal text-[#93828c]">
          Enter Customization Code
        </label>
        <div className="relative flex items-center">
          <input
            id="customization-code-input"
            type="text"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Paste code here…"
            className="h-10 w-full rounded-[2px] border border-white/10 bg-[#1f2025] px-3 pr-16 font-mono text-xs text-[#e6e1d8] transition-colors focus:border-[#eac87f] focus:outline-none"
          />
          {/* Trash (Clear) and Copy Action Buttons */}
          <div className="absolute right-2 flex items-center gap-1.5">
            {code && (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear code"
                title="Clear"
                className="flex h-6 w-6 items-center justify-center text-[#7a7882] transition-colors hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M4 7 L20 7 M10 11 L10 17 M14 11 L14 17 M5 7 L6 19 C6 20 7 21 8 21 L16 21 C17 21 18 20 19 19 L20 7 M9 7 L9 4 L15 4 L15 7" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy code to clipboard"
              title="Copy"
              className="flex h-6 w-6 items-center justify-center text-[#7a7882] transition-colors hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15 L5 5 C5 4 6 3 7 3 L15 3" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
