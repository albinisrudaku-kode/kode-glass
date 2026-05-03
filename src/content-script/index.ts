import {RuntimeMessageType, type ContentReadyMessage, type RuntimeMessage} from '../shared/messages';
import type {AuditSettings} from '../shared/accessibility-report';
import {PageOverlay} from './page-overlay';
import type {analyzeCurrentPage} from '../shared/engines/accessibility-engine';

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

  pageOverlay.onActiveNodeChanged(activeNode => {
    void dispatchRuntimeMessage({
      payload: activeNode,
      type: RuntimeMessageType.ActiveNodeChanged,
    });
  });

  pageOverlay.onViolationSelected(payload => {
    void dispatchRuntimeMessage({
      payload,
      type: RuntimeMessageType.ViolationSelected,
    });
  });

  void sendContentReadyMessage();

  chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
    if (message.type === RuntimeMessageType.PageContextRequested) {
      void sendContentReadyMessage().catch(error => {
        sendAnalysisFailure(new Error(`Failed to sync page context: ${getErrorMessage(error)}`));
      });
    }

    if (message.type === RuntimeMessageType.AnalysisRequested) {
      void runAnalysis(pageOverlay, message.payload).catch(error => sendAnalysisFailure(error));
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

async function runAnalysis(pageOverlay: PageOverlay, auditSettings: AuditSettings): Promise<void> {
  await sendContentReadyMessage();

  const report = await getAnalyzeCurrentPage()(auditSettings);

  pageOverlay.setReport(report);

  await dispatchRuntimeMessage({
    payload: report,
    type: RuntimeMessageType.ReportGenerated,
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
