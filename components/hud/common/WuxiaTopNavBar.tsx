'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/cn';
import { IconDoubleChevron } from '@/components/hud/outfit/WuxiaSlotIcons';

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
  /** Whether to show the navigation arrows (default true) */
  showArrows?: boolean;
  /** Whether to show the Q and E keycap hints (default true) */
  showKeycaps?: boolean;
  /** Legacy prop for backward compatibility */
  showPrevKeycap?: boolean;
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
  onSearch: _onSearch,
  onToggleCollapse,
  isCollapsed = false,
  searchHotkey: _searchHotkey,
  navHotkeys = { prev: 'q', next: 'e' },
  enableHotkeys = true,
  leftSlot,
  rightSlot,
  className,
  showArrows = true,
  showKeycaps = true,
  showPrevKeycap: _showPrevKeycap,
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

  // Global hotkeys (E to next, Q to prev when multiple tabs)
  useEffect(() => {
    if (!enableHotkeys || isCollapsed || tabs.length <= 1) return;

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
      if (key === navHotkeys.prev.toLowerCase()) {
        e.preventDefault();
        cycleTab('prev');
      } else if (key === navHotkeys.next.toLowerCase()) {
        e.preventDefault();
        cycleTab('next');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableHotkeys, isCollapsed, navHotkeys, cycleTab, tabs.length]);

  return (
    <header
      className={cn(
        'pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-[52px] items-center justify-between gap-2 px-3 sm:px-6 select-none',
        className
      )}
      aria-label="Top Navigation Bar"
    >
      {/* Left Slot: Custom Content or clean spacer */}
      <div className="flex shrink-0 items-center gap-2">
        {leftSlot ?? null}
      </div>

      {/* Center: Navigation Carousel (flows cleanly without overlapping rightSlot) */}
      <nav
        className="flex min-w-0 flex-1 items-center justify-center gap-1.5 sm:gap-3 text-sm font-sans"
        aria-label="Category Carousel"
      >
        {/* Previous Category Keycap Hint (e.g. [Q]) */}
        {showKeycaps && (
          <span
            className={cn(
              'flex h-[18px] items-center justify-center rounded-[2px] border border-white/20 bg-[#5f5a5e]/70 px-1 font-mono text-[10px] font-medium text-[#eae5dc]',
              tabs.length <= 1 && 'opacity-40'
            )}
            aria-hidden
          >
            {navHotkeys.prev.toUpperCase()}
          </span>
        )}

        {/* Left Arrow */}
        {showArrows && (
          <button
            type="button"
            disabled={tabs.length <= 1}
            onClick={() => cycleTab('prev')}
            aria-label="Previous category"
            className={cn(
              'flex h-6 w-6 items-center justify-center text-[#93828c] transition-colors hover:text-[#e4cca8] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]',
              tabs.length <= 1 && 'opacity-30 cursor-default hover:text-[#93828c]'
            )}
          >
            ◄
          </button>
        )}

        {/* Tab Items */}
        <div className="flex items-center gap-3 sm:gap-5 overflow-x-auto max-w-[calc(100vw-280px)] sm:max-w-none scrollbar-none">
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
        {showArrows && (
          <button
            type="button"
            disabled={tabs.length <= 1}
            onClick={() => cycleTab('next')}
            aria-label="Next category"
            className={cn(
              'flex h-6 w-6 items-center justify-center text-[#93828c] transition-colors hover:text-[#e4cca8] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]',
              tabs.length <= 1 && 'opacity-30 cursor-default hover:text-[#93828c]'
            )}
          >
            ►
          </button>
        )}

        {/* Next Category Keycap Hint (e.g. [E]) */}
        {showKeycaps && (
          <span
            className={cn(
              'flex h-[18px] items-center justify-center rounded-[2px] border border-white/20 bg-[#5f5a5e]/70 px-1 font-mono text-[10px] font-medium text-[#eae5dc]',
              tabs.length <= 1 && 'opacity-40'
            )}
            aria-hidden
          >
            {navHotkeys.next.toUpperCase()}
          </span>
        )}
      </nav>

      {/* Right Slot: Custom Content + Collapse Toggle */}
      <div className="flex items-center gap-2 pointer-events-auto">
        {rightSlot}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-pressed={isCollapsed}
            aria-label={isCollapsed ? 'Return to editor' : 'Collapse HUD into full preview'}
            title={isCollapsed ? 'Return to editor' : 'Full Preview (Collapse HUD)'}
            className="flex h-7 w-7 items-center justify-center rounded-[2px] border border-white/10 bg-[#202126]/80 text-[#cfcacf] backdrop-blur-md transition-all hover:border-[#d4b483]/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
          >
            <IconDoubleChevron className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  );
}
