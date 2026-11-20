'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/cn';
import { IconDoubleChevron, IconSearch } from '@/components/hud/outfit/WuxiaSlotIcons';

export interface TopNavTab {
  id: string;
  label: string;
  hasRedDot?: boolean;
  disabled?: boolean;
}

export const DEFAULT_WUXIA_TABS: readonly TopNavTab[] = [
  { id: 'wardrobe', label: 'Wardrobe', hasRedDot: true },
  { id: 'backgrounds', label: 'Backgrounds' },
  { id: 'weapon', label: 'Weapon' },
  { id: 'mounts', label: 'Mounts' },
  { id: 'extras', label: 'Extras' },
  { id: 'world', label: 'World' },
] as const;

export interface WuxiaTopNavBarProps {
  /** List of tabs to display in the carousel */
  tabs?: readonly TopNavTab[];
  /** Controlled active tab ID */
  activeTab?: string;
  /** Default tab ID if uncontrolled */
  defaultTab?: string;
  /** Callback when the active tab changes */
  onTabChange?: (tabId: string) => void;
  /** Callback when the search action is triggered */
  onSearch?: () => void;
  /** Callback when the collapse/preview button is clicked */
  onToggleCollapse?: () => void;
  /** Whether the HUD is currently collapsed / in preview mode */
  isCollapsed?: boolean;
  /** Custom keycap for the search action (default 'Q') */
  searchHotkey?: string;
  /** Previous and next cycle hotkeys (default { prev: 'q', next: 'e' }) */
  navHotkeys?: { prev: string; next: string };
  /** Whether keyboard shortcuts (Q/E) are enabled (default true) */
  enableHotkeys?: boolean;
  /** Optional custom content to render in the left slot */
  leftSlot?: React.ReactNode;
  /** Optional custom content to render in the right slot */
  rightSlot?: React.ReactNode;
  /** Additional CSS class names for the outer header */
  className?: string;
}

/**
 * Reusable Wuxia-themed Top Navigation Bar with keyboard navigation,
 * unread badges, smooth carousels, and collapse triggers.
 */
export function WuxiaTopNavBar({
  tabs = DEFAULT_WUXIA_TABS,
  activeTab: controlledTab,
  defaultTab = tabs[0]?.id ?? 'wardrobe',
  onTabChange,
  onSearch,
  onToggleCollapse,
  isCollapsed = false,
  searchHotkey = 'Q',
  navHotkeys = { prev: 'q', next: 'e' },
  enableHotkeys = true,
  leftSlot,
  rightSlot,
  className,
}: WuxiaTopNavBarProps) {
  const [internalTab, setInternalTab] = useState(defaultTab);
  const currentTab = controlledTab !== undefined ? controlledTab : internalTab;

  const selectTab = useCallback(
    (tabId: string) => {
      if (controlledTab === undefined) {
        setInternalTab(tabId);
      }
      onTabChange?.(tabId);
    },
    [controlledTab, onTabChange]
  );

  const cycleTab = useCallback(
    (direction: 'prev' | 'next') => {
      const idx = tabs.findIndex(t => t.id === currentTab);
      if (idx === -1) return;
      let nextIdx = direction === 'next' ? idx + 1 : idx - 1;
      if (nextIdx >= tabs.length) nextIdx = 0;
      if (nextIdx < 0) nextIdx = tabs.length - 1;
      selectTab(tabs[nextIdx].id);
    },
    [tabs, currentTab, selectTab]
  );

  // Global hotkeys (Q to search, E to next, etc.)
  useEffect(() => {
    if (!enableHotkeys || isCollapsed) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (searchHotkey && key === searchHotkey.toLowerCase()) {
        e.preventDefault();
        onSearch?.();
      } else if (key === navHotkeys.prev.toLowerCase()) {
        e.preventDefault();
        cycleTab('prev');
      } else if (key === navHotkeys.next.toLowerCase()) {
        e.preventDefault();
        cycleTab('next');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableHotkeys, isCollapsed, navHotkeys, cycleTab, searchHotkey, onSearch]);

  return (
    <header
      className={cn(
        'pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-[52px] items-center justify-between px-3 sm:px-8 select-none',
        className
      )}
      aria-label="Top Navigation Bar"
    >
      {/* Left Slot: Search Button or Custom Content */}
      <div className="flex items-center gap-2">
        {leftSlot ?? (
          <button
            type="button"
            onClick={onSearch}
            aria-label={`Search items (${searchHotkey})`}
            title={`Search items (${searchHotkey})`}
            className="group flex h-7 items-center gap-1.5 rounded-[2px] border border-white/10 bg-[#202126]/80 px-2 py-0.5 text-[#cfcacf] backdrop-blur-md transition-all hover:border-[#d4b483]/40 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
          >
            <IconSearch className="h-3.5 w-3.5 text-[#93828c] group-hover:text-[#e4cca8]" />
            <span className="flex h-[18px] items-center justify-center rounded-[2px] border border-white/20 bg-[#5f5a5e]/70 px-1 font-mono text-[10px] font-medium text-[#eae5dc]">
              {searchHotkey}
            </span>
          </button>
        )}
      </div>

      {/* Center: Navigation Carousel */}
      <nav className="flex items-center gap-2 sm:gap-4 text-sm font-sans" aria-label="Category Carousel">
        {/* Left Arrow */}
        <button
          type="button"
          onClick={() => cycleTab('prev')}
          aria-label="Previous category"
          className="flex h-6 w-6 items-center justify-center text-[#93828c] transition-colors hover:text-[#e4cca8] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]"
        >
          ◄
        </button>

        {/* Tab Items */}
        <div className="flex items-center gap-3 sm:gap-5 overflow-x-auto max-w-[calc(100vw-130px)] sm:max-w-none">
          {tabs.map(tab => {
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                disabled={tab.disabled}
                onClick={() => selectTab(tab.id)}
                aria-pressed={isActive}
                className={cn(
                  'group relative text-[14.5px] tracking-wide transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]',
                  isActive
                    ? 'font-medium text-[#e4cca8]'
                    : 'text-[#93828c] hover:text-[#d4c8cf]',
                  tab.disabled && 'cursor-not-allowed opacity-40'
                )}
              >
                <span>{tab.label}</span>

                {/* Active Indicator Underline */}
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute -bottom-1 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#e4cca8] to-transparent opacity-90"
                  />
                )}

                {/* Red Notification Dot */}
                {tab.hasRedDot && (
                  <span
                    aria-hidden
                    className="absolute -top-1 -right-2 h-1.5 w-1.5 rounded-full bg-[#d7443e] shadow-[0_0_6px_rgba(215,68,62,0.8)]"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Right Arrow */}
        <button
          type="button"
          onClick={() => cycleTab('next')}
          aria-label="Next category"
          className="flex h-6 w-6 items-center justify-center text-[#93828c] transition-colors hover:text-[#e4cca8] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]"
        >
          ►
        </button>

        {/* Next Category Keycap Hint */}
        <span
          className="flex h-[18px] items-center justify-center rounded-[2px] border border-white/20 bg-[#5f5a5e]/70 px-1 font-mono text-[10px] font-medium text-[#eae5dc]"
          aria-hidden
        >
          {navHotkeys.next.toUpperCase()}
        </span>
      </nav>

      {/* Right Slot: Collapse Toggle or Custom Content */}
      <div className="flex items-center">
        {rightSlot ?? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-pressed={isCollapsed}
            aria-label={isCollapsed ? 'Return to editor' : 'Collapse HUD into full preview'}
            title={isCollapsed ? 'Return to editor' : 'Full Preview (Collapse HUD)'}
            className="flex h-8 w-8 items-center justify-center rounded-[2px] border border-white/10 bg-[#202126]/80 text-[#cfcacf] backdrop-blur-md transition-all hover:border-[#d4b483]/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
          >
            <IconDoubleChevron className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  );
}
