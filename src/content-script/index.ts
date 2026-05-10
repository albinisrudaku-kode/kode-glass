import {RuntimeMessageType, type CaptureBoundsRequestPayload, type ContentReadyMessage, type RuntimeMessage} from '../shared/messages';
import type {AuditSettings} from '../shared/accessibility-report';
import {PageOverlay} from './page-overlay';
import type {analyzeCurrentPage} from '../shared/engines/accessibility-engine';
import {collectDetectedComponentOptions, enrichViolationsWithComponentScope} from './component-scope';
import {getErrorMessage, silenced} from '../shared/error-boundary';
import {installNavigationWatcher, type ContentScriptNavigationState} from './bootstrap/navigation';
import {dispatchRuntimeMessage} from './bootstrap/messaging';

type AnalyzeCurrentPage = typeof analyzeCurrentPage;

interface KodeGlassWindow extends Window {
  __kodeGlassAnalyzeCurrentPage?: AnalyzeCurrentPage;
  __kodeGlassContentScriptInitialized?: boolean;
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
    }).catch(() => silenced());
  });

  pageOverlay.onComponentScopeChanged(payload => {
    void dispatchRuntimeMessage({
      payload,
      type: RuntimeMessageType.ComponentScopeChanged,
    }).catch(() => silenced());
  });

  pageOverlay.onViolationSelected(payload => {
    void dispatchRuntimeMessage({
      payload,
      type: RuntimeMessageType.ViolationSelected,
    }).catch(() => silenced());
  });

  installNavigationWatcher(pageOverlay, navigationState, {
    onNavigationDetected: () => {
      void dispatchRuntimeMessage({
        payload: {},
        type: RuntimeMessageType.TabReloaded,
      }).catch(() => silenced());
    },
    onSyncRequested: () => {
      void sendContentReadyMessage().catch(error => {
        sendAnalysisFailure(new Error(`Failed to sync page context: ${getErrorMessage(error)}`));
      });
    },
    scheduleMs: 120,
  });

  window.addEventListener('beforeunload', () => pageOverlay.dispose());

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

    if (message.type === RuntimeMessageType.ReaderCommandRequested) {
      pageOverlay.applyNarratorCommand(message.payload);
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

