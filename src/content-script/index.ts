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
    if (!chrome.runtime?.id) {
      return;
    }

    void chrome.runtime.sendMessage({
      payload: activeNode,
      type: RuntimeMessageType.ActiveNodeChanged,
    });
  });

  pageOverlay.onViolationSelected(payload => {
    if (!chrome.runtime?.id) {
      return;
    }

    void chrome.runtime.sendMessage({
      payload,
      type: RuntimeMessageType.ViolationSelected,
    });
  });

  if (chrome.runtime?.id) {
    void chrome.runtime.sendMessage(createContentReadyMessage());
  }

  chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
    if (message.type === RuntimeMessageType.PageContextRequested) {
      void chrome.runtime.sendMessage(createContentReadyMessage()).catch(() => undefined);
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

      void chrome.runtime.sendMessage({
        payload: {},
        type: RuntimeMessageType.ResetCompleted,
      });
    }

    return false;
  });
}

async function runAnalysis(pageOverlay: PageOverlay, auditSettings: AuditSettings): Promise<void> {
  await chrome.runtime.sendMessage(createContentReadyMessage());

  const report = await getAnalyzeCurrentPage()(auditSettings);

  pageOverlay.setReport(report);

  await chrome.runtime.sendMessage({
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
  void chrome.runtime.sendMessage({
    payload: {
      message: error instanceof Error ? error.message : String(error),
    },
    type: RuntimeMessageType.AnalysisFailed,
  }).catch(() => undefined);
}
