import {RuntimeMessageType, type ContentReadyMessage, type RuntimeMessage} from '../shared/messages';
import {analyzeCurrentPage} from '../shared/engines/axe-engine';
import type {AuditSettings} from '../shared/accessibility-report';
import {PageOverlay} from './page-overlay';

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

const contentReadyMessage: ContentReadyMessage = {
  payload: {
    title: document.title,
    url: location.href,
  },
  type: RuntimeMessageType.ContentReady,
};

if (chrome.runtime?.id) {
  void chrome.runtime.sendMessage(contentReadyMessage);
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message.type === RuntimeMessageType.AnalysisRequested) {
    void runAnalysis(message.payload).catch(error => sendAnalysisFailure(error));
  }

  if (message.type === RuntimeMessageType.LayerVisibilityChanged) {
    pageOverlay.setLayerVisibility(message.payload);
  }

  if (message.type === RuntimeMessageType.ReaderModeChanged) {
    pageOverlay.setReaderMode(message.payload);
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

async function runAnalysis(auditSettings: AuditSettings): Promise<void> {
  await chrome.runtime.sendMessage(contentReadyMessage);

  const report = await analyzeCurrentPage(auditSettings);

  pageOverlay.setReport(report);

  await chrome.runtime.sendMessage({
    payload: report,
    type: RuntimeMessageType.ReportGenerated,
  });
}

function sendAnalysisFailure(error: unknown): void {
  void chrome.runtime.sendMessage({
    payload: {
      message: error instanceof Error ? error.message : String(error),
    },
    type: RuntimeMessageType.AnalysisFailed,
  }).catch(() => undefined);
}
