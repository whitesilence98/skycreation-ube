'use client';

import { useEffect, useRef } from 'react';
import { formatAppHash, parseAppHash, type AppRoute, type AppRouteSnapshot } from '@/lib/appRouter';
import { useBuilderStore } from '@/lib/builderStore';
import { navigateCategory } from '@/lib/editorNav';
import { editorCategory } from '@/lib/faceControls';
import { useCharacter } from '@/lib/store';

function currentSnapshot(): AppRouteSnapshot {
  const char = useCharacter.getState();
  const builder = useBuilderStore.getState();
  return {
    appMode: char.appMode,
    primaryTab: char.primaryTab,
    studioPage: char.studioPage,
    builderMode: builder.mode,
  };
}

function applyRouteToStores(route: AppRoute): void {
  const char = useCharacter.getState();
  const builder = useBuilderStore.getState();

  if (route.appMode === 'builder') {
    if (char.appMode !== 'builder') {
      char.setAppMode('builder');
    }
    const targetMode = route.builderMode ?? builder.mode;
    if (builder.mode !== targetMode) {
      builder.setMode(targetMode);
    }
    return;
  }

  if (char.appMode !== 'studio') {
    char.setAppMode('studio');
  }

  const currentCategory = editorCategory(char.primaryTab);
  if (currentCategory !== route.category) {
    navigateCategory(route.category);
  }

  if (useCharacter.getState().studioPage !== route.studioPage) {
    char.setStudioPage(route.studioPage);
  }
}

function writeBrowserHash(nextHash: string, mode: 'push' | 'replace'): void {
  if (typeof window === 'undefined') return;
  if (window.location.hash === nextHash) return;
  if (mode === 'push') {
    window.history.pushState(window.history.state, '', nextHash);
  } else {
    window.history.replaceState(window.history.state, '', nextHash);
  }
}

/**
 * Synchronizes Studio tabs, Smart Customization, and Room Builder modes
 * with `window.location.hash` and browser Back/Forward history.
 */
export function AppRouter() {
  const hydrated = useCharacter((s) => s.hydrated);
  const applyingFromHistoryRef = useRef(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!hydrated) return;

    // 1. Initial sync after localStorage session restore completes.
    if (!initializedRef.current) {
      initializedRef.current = true;
      const parsed = parseAppHash(window.location.hash);
      if (parsed) {
        applyingFromHistoryRef.current = true;
        try {
          applyRouteToStores(parsed);
        } finally {
          applyingFromHistoryRef.current = false;
        }
      }
      // Always normalize canonical hash on initial load without pushing a duplicate entry.
      writeBrowserHash(formatAppHash(currentSnapshot()), 'replace');
    }

    // 2. Push URL hash when store navigation state changes from UI interactions.
    let lastCanonicalHash = formatAppHash(currentSnapshot());
    const syncStoreToUrl = () => {
      if (applyingFromHistoryRef.current) {
        lastCanonicalHash = formatAppHash(currentSnapshot());
        return;
      }
      const nextHash = formatAppHash(currentSnapshot());
      if (nextHash === lastCanonicalHash && window.location.hash === nextHash) return;
      lastCanonicalHash = nextHash;
      writeBrowserHash(nextHash, 'push');
    };

    const unsubChar = useCharacter.subscribe((state, prev) => {
      if (
        state.appMode === prev.appMode &&
        state.primaryTab === prev.primaryTab &&
        state.studioPage === prev.studioPage
      ) {
        return;
      }
      syncStoreToUrl();
    });

    const unsubBuilder = useBuilderStore.subscribe((state, prev) => {
      if (state.mode === prev.mode) return;
      if (useCharacter.getState().appMode !== 'builder') return;
      syncStoreToUrl();
    });

    // 3. Apply URL changes when user navigates Back/Forward or edits the hash.
    const onUrlChange = () => {
      const parsed = parseAppHash(window.location.hash);
      if (!parsed) {
        writeBrowserHash(formatAppHash(currentSnapshot()), 'replace');
        return;
      }

      const currentHash = formatAppHash(currentSnapshot());
      const targetSnapshotHash =
        parsed.appMode === 'builder'
          ? `#room/${parsed.builderMode ?? useBuilderStore.getState().mode}`
          : formatAppHash({
              appMode: 'studio',
              primaryTab: parsed.primaryTab,
              studioPage: parsed.studioPage,
              builderMode: useBuilderStore.getState().mode,
            });

      if (currentHash !== targetSnapshotHash) {
        applyingFromHistoryRef.current = true;
        try {
          applyRouteToStores(parsed);
        } finally {
          applyingFromHistoryRef.current = false;
        }
      }

      const canonical = formatAppHash(currentSnapshot());
      lastCanonicalHash = canonical;
      if (window.location.hash !== canonical) {
        writeBrowserHash(canonical, 'replace');
      }
    };

    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('hashchange', onUrlChange);

    return () => {
      unsubChar();
      unsubBuilder();
      window.removeEventListener('popstate', onUrlChange);
      window.removeEventListener('hashchange', onUrlChange);
    };
  }, [hydrated]);

  return null;
}
