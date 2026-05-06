import {RuntimeMessageType, type CaptureBoundsRequestPayload, type ContentReadyMessage, type RuntimeMessage} from '../shared/messages';
import type {AuditSettings} from '../shared/accessibility-report';
import {PageOverlay} from './page-overlay';
import type {analyzeCurrentPage} from '../shared/engines/accessibility-engine';
import {collectDetectedComponentOptions, enrichViolationsWithComponentScope} from './component-scope';

type AnalyzeCurrentPage = typeof analyzeCurrentPage;

interface KodeGlassWindow extends Window {
  __kodeGlassAnalyzeCurrentPage?: AnalyzeCurrentPage;
  __kodeGlassContentScriptInitialized?: boolean;
}

interface ContentScriptNavigationState {
  latestUrl: string;
  navigationRevision: number;
  syncTimer: ReturnType<typeof setTimeout> | undefined;
}

const kodeGlassWindow = window as KodeGlassWindow;

if (!kodeGlassWindow.__kodeGlassContentScriptInitialized) {
  kodeGlassWindow.__kodeGlassContentScriptInitialized = true;
  initializeContentScript();
}

function initializeContentScript(): void {
  const pageOverlay = new PageOverlay();
  const navigationState: ContentScriptNavigationState = {
    latestUrl: location.href,
    navigationRevision: 0,
    syncTimer: undefined,
  };

  pageOverlay.onActiveNodeChanged(activeNode => {
    void dispatchRuntimeMessage({
      payload: activeNode,
      type: RuntimeMessageType.ActiveNodeChanged,
    }).catch(() => undefined);
  });

  pageOverlay.onComponentScopeChanged(payload => {
    void dispatchRuntimeMessage({
      payload,
      type: RuntimeMessageType.ComponentScopeChanged,
    }).catch(() => undefined);
  });

  pageOverlay.onViolationSelected(payload => {
    void dispatchRuntimeMessage({
      payload,
      type: RuntimeMessageType.ViolationSelected,
    }).catch(() => undefined);
  });

  installNavigationWatcher(pageOverlay, navigationState);

  void sendContentReadyMessage();

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === RuntimeMessageType.CaptureBoundsRequested) {
      void pageOverlay.requestCaptureSnapshot(message.payload.mode as CaptureBoundsRequestPayload['mode'])
        .then(snapshot => sendResponse({ok: true, snapshot}))
        .catch(error => sendResponse({error: getErrorMessage(error), ok: false}));

      return true;
    }

    if (message.type === RuntimeMessageType.PageContextRequested) {
      void sendContentReadyMessage().catch(error => {
        sendAnalysisFailure(new Error(`Failed to sync page context: ${getErrorMessage(error)}`));
      });
    }

    if (message.type === RuntimeMessageType.AnalysisRequested) {
      void runAnalysis(pageOverlay, message.payload, navigationState).catch(error => sendAnalysisFailure(error));
    }

    if (message.type === RuntimeMessageType.LayerVisibilityChanged) {
      pageOverlay.setLayerVisibility(message.payload);
    }

    if (message.type === RuntimeMessageType.ReaderModeChanged) {
      pageOverlay.setReaderMode(message.payload);
    }

    if (message.type === RuntimeMessageType.ViolationFiltersChanged) {
      pageOverlay.setViolationFilters(message.payload);
    }

    if (message.type === RuntimeMessageType.ComponentScopeChanged) {
      pageOverlay.setComponentScope(message.payload);
    }

    if (message.type === RuntimeMessageType.ViolationFocusChanged) {
      pageOverlay.setSelectedViolationFocus(message.payload);
    }

    if (message.type === RuntimeMessageType.ResetRequested) {
      pageOverlay.reset();

      void dispatchRuntimeMessage({
        payload: {},
        type: RuntimeMessageType.ResetCompleted,
      });
    }

    return false;
  });
}

function installNavigationWatcher(pageOverlay: PageOverlay, navigationState: ContentScriptNavigationState): void {
  const handlePotentialNavigation = (): void => {
    const currentUrl = location.href;

    if (currentUrl === navigationState.latestUrl) {
      return;
    }

    navigationState.latestUrl = currentUrl;
    navigationState.navigationRevision += 1;
    pageOverlay.reset();
    window.speechSynthesis?.cancel();

    void dispatchRuntimeMessage({
      payload: {},
      type: RuntimeMessageType.TabReloaded,
    }).catch(() => undefined);

    clearTimeout(navigationState.syncTimer);
    navigationState.syncTimer = setTimeout(() => {
      void sendContentReadyMessage().catch(error => {
        sendAnalysisFailure(new Error(`Failed to sync page context: ${getErrorMessage(error)}`));
      });
    }, 120);
  };

  wrapHistoryNavigation('pushState', handlePotentialNavigation);
  wrapHistoryNavigation('replaceState', handlePotentialNavigation);
  window.addEventListener('popstate', handlePotentialNavigation, {passive: true});
  window.addEventListener('hashchange', handlePotentialNavigation, {passive: true});
}

function wrapHistoryNavigation(methodName: 'pushState' | 'replaceState', onNavigation: () => void): void {
  const originalMethod = history[methodName];

  history[methodName] = function patchedHistoryMethod(...args: Parameters<typeof originalMethod>): ReturnType<typeof originalMethod> {
    const result = originalMethod.apply(this, args);
    queueMicrotask(onNavigation);

    return result;
  } as typeof originalMethod;
}

async function runAnalysis(
  pageOverlay: PageOverlay,
  auditSettings: AuditSettings,
  navigationState: ContentScriptNavigationState,
): Promise<void> {
  const analysisNavigationRevision = navigationState.navigationRevision;
  await sendContentReadyMessage();

  const rawReport = await getAnalyzeCurrentPage()(auditSettings);

  if (analysisNavigationRevision !== navigationState.navigationRevision || rawReport.pageUrl !== location.href) {
    return;
  }

  const report = {
    ...rawReport,
    violations: enrichViolationsWithComponentScope(rawReport.violations),
  };
  const componentInventory = collectDetectedComponentOptions();

  pageOverlay.setReport(report);

  await dispatchRuntimeMessage({
    payload: report,
    type: RuntimeMessageType.ReportGenerated,
  });

  await dispatchRuntimeMessage({
    payload: componentInventory,
    type: RuntimeMessageType.ComponentInventoryChanged,
  });
}

function createContentReadyMessage(): ContentReadyMessage {
  return {
    payload: {
      title: document.title,
      url: location.href,
    },
    type: RuntimeMessageType.ContentReady,
  };
}

function getAnalyzeCurrentPage(): AnalyzeCurrentPage {
  const analyzeCurrentPage = kodeGlassWindow.__kodeGlassAnalyzeCurrentPage;

  if (!analyzeCurrentPage) {
    throw new Error('The accessibility analyzer bundle was not loaded. Try running the scan again.');
  }

  return analyzeCurrentPage;
}

function sendAnalysisFailure(error: unknown): void {
  void dispatchRuntimeMessage({
    payload: {
      message: error instanceof Error ? error.message : String(error),
    },
    type: RuntimeMessageType.AnalysisFailed,
  });
}

async function sendContentReadyMessage(): Promise<void> {
  await dispatchRuntimeMessage(createContentReadyMessage());
}

async function dispatchRuntimeMessage(message: RuntimeMessage): Promise<void> {
  if (!chrome.runtime?.id) {
    throw new Error('Extension runtime is unavailable.');
  }

  await chrome.runtime.sendMessage(message);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
