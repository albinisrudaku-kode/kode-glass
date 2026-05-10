import {
  RuntimeMessageType,
  type EvidenceImageCaptureRequestedMessage,
  type EvidenceImageCaptureResponse,
} from '../shared/messages';
import type {CaptureBoundsSnapshot} from '../shared/accessibility-report';
import {activeTabId, buildEvidenceFileNameBase, ensureContentScript, wait} from './message-router';

const visibleTabCaptureCooldownMs = 650;
let lastVisibleTabCaptureAt = 0;

export async function captureEvidenceImage(
  message: EvidenceImageCaptureRequestedMessage,
): Promise<EvidenceImageCaptureResponse> {
  const tabId = message.tabId ?? activeTabId;

  if (tabId === undefined) {
    return {error: 'No active tab available for capture.', ok: false};
  }

  if (!await ensureContentScript(tabId)) {
    return {error: 'Unable to access this tab for capture.', ok: false};
  }

  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;
  const snapshot = message.payload.mode === 'full-screen'
    ? undefined
    : await requestCaptureBoundsFromTab(tabId, message.payload.mode);

  if (message.payload.mode !== 'full-screen' && !snapshot) {
    return {error: 'No target selected for image capture.', ok: false};
  }

  await waitForVisibleTabCaptureSlot();
  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(windowId, {format: 'png'});

  return {
    fileNameBase: buildEvidenceFileNameBase(message.payload.mode),
    ok: true,
    screenshotDataUrl,
    snapshot,
  };
}

export async function waitForVisibleTabCaptureSlot(): Promise<void> {
  const elapsedMs = Date.now() - lastVisibleTabCaptureAt;
  const delayMs = Math.max(0, visibleTabCaptureCooldownMs - elapsedMs);

  if (delayMs > 0) {
    await wait(delayMs);
  }

  lastVisibleTabCaptureAt = Date.now();
}

export async function requestCaptureBoundsFromTab(
  tabId: number,
  mode: 'element' | 'free-select',
): Promise<CaptureBoundsSnapshot | undefined> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      payload: {mode},
      tabId,
      type: RuntimeMessageType.CaptureBoundsRequested,
    }) as {readonly ok: boolean; readonly snapshot?: CaptureBoundsSnapshot};

    return response.ok ? response.snapshot : undefined;
  } catch {
    return undefined;
  }
}


