import type {PageOverlay} from '../page-overlay';

export interface NavigationSyncCallbacks {
  readonly onNavigationDetected: () => void;
  readonly onSyncRequested: () => void;
  readonly scheduleMs?: number;
}

export interface ContentScriptNavigationState {
  latestUrl: string;
  navigationRevision: number;
  syncTimer: ReturnType<typeof setTimeout> | undefined;
}

export function installNavigationWatcher(
  pageOverlay: PageOverlay,
  navigationState: ContentScriptNavigationState,
  callbacks: NavigationSyncCallbacks,
): void {
  const handlePotentialNavigation = (): void => {
    const currentUrl = location.href;

    if (currentUrl === navigationState.latestUrl) {
      return;
    }

    navigationState.latestUrl = currentUrl;
    navigationState.navigationRevision += 1;
    pageOverlay.reset();
    window.speechSynthesis?.cancel();
    callbacks.onNavigationDetected();
    clearTimeout(navigationState.syncTimer);
    navigationState.syncTimer = setTimeout(() => callbacks.onSyncRequested(), callbacks.scheduleMs ?? 120);
  };

  wrapHistoryNavigation('pushState', handlePotentialNavigation);
  wrapHistoryNavigation('replaceState', handlePotentialNavigation);
  window.addEventListener('popstate', handlePotentialNavigation, {passive: true});
  window.addEventListener('hashchange', handlePotentialNavigation, {passive: true});
}

function wrapHistoryNavigation(methodName: 'pushState' | 'replaceState', onNavigation: () => void): void {
  const originalMethod = history[methodName];

  history[methodName] = function patchedHistoryMethod(this: History, ...args: Parameters<typeof originalMethod>): ReturnType<typeof originalMethod> {
    const result = originalMethod.apply(this, args);
    queueMicrotask(onNavigation);

    return result;
  } as typeof originalMethod;
}
