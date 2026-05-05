import {
  RuntimeMessageType,
  type EvidenceImageCaptureRequestedMessage,
  type EvidenceImageCaptureResponse,
  type EvidenceVideoBufferToggledMessage,
  type EvidenceVideoBufferToggleResponse,
  type EvidenceVideoRollbackRequestedMessage,
  type EvidenceVideoRollbackResponse,
  type ReaderSpeakPayload,
  type ReportGeneratedMessage,
  type RuntimeMessage,
} from '../shared/messages';
import type {CaptureBoundsSnapshot} from '../shared/accessibility-report';

const latestMessagesByTab = new Map<number, RuntimeMessage>();
const latestReportsByTab = new Map<number, ReportGeneratedMessage>();
const analyzerInjectedTabs = new Set<number>();
const videoBuffersByTab = new Map<number, TabVideoBufferState>();
let activeTabId: number | undefined;
const sidePanelPath = 'side-panel.html';
const sidePanelPortName = 'kode-glass-side-panel';
const videoChunkTimesliceMs = 1000;
const maxRollbackWindowMs = 5 * 60 * 1000;

interface TabVideoBufferState {
  readonly chunks: Array<{readonly blob: Blob; readonly recordedAt: number}>;
  readonly mimeType: string;
  readonly recorder: MediaRecorder;
  readonly stream: MediaStream;
}

const extensionApi = globalThis.chrome;

if (!extensionApi?.runtime || !extensionApi?.tabs) {
  console.warn('Kode Glass background: extension APIs unavailable.');
} else {
  extensionApi.runtime.onInstalled?.addListener(() => {
    void extensionApi.sidePanel?.setPanelBehavior({openPanelOnActionClick: false});
    void enableSidePanelForOpenTabs();
  });

  extensionApi.runtime.onStartup?.addListener(() => {
    void enableSidePanelForOpenTabs();
  });

  extensionApi.action?.onClicked.addListener(tab => {
    if (tab.id === undefined) {
      return;
    }

    activeTabId = tab.id;
    void enableSidePanelForTab(tab.id);
    void ensureContentScript(tab.id);
    void extensionApi.sidePanel?.open({tabId: tab.id});
  });

  extensionApi.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.type === RuntimeMessageType.EvidenceImageCaptureRequested) {
    void captureEvidenceImage(message)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({error: getErrorMessage(error), ok: false} satisfies EvidenceImageCaptureResponse));

    return true;
  }

  if (message.type === RuntimeMessageType.EvidenceVideoBufferToggled) {
    void toggleVideoBuffer(message)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({error: getErrorMessage(error), ok: false} satisfies EvidenceVideoBufferToggleResponse));

    return true;
  }

  if (message.type === RuntimeMessageType.EvidenceVideoRollbackRequested) {
    void downloadRollbackVideo(message)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({error: getErrorMessage(error), ok: false} satisfies EvidenceVideoRollbackResponse));

    return true;
  }

  const tabId = sender.tab?.id;
  const messageForPanel = tabId === undefined ? message : {...message, tabId};

  if (message.type === RuntimeMessageType.PanelOpened) {
    void hydratePanelForTab(message.tabId);

    return false;
  }

  if (
    message.type === RuntimeMessageType.ReaderModeChanged
    && (!message.payload.speak || !message.payload.enabled)
  ) {
    chrome.tts.stop();
  }

  if (message.type === RuntimeMessageType.ResetRequested) {
    chrome.tts.stop();
  }

  if (message.type === RuntimeMessageType.ReaderSpeakRequested) {
    speakReaderLine(message.payload);

    return false;
  }

  if (
    tabId !== undefined
    && message.type !== RuntimeMessageType.ActiveNodeChanged
  ) {
    if (message.type === RuntimeMessageType.ReportGenerated) {
      latestReportsByTab.set(tabId, messageForPanel as ReportGeneratedMessage);
    }

    if (message.type === RuntimeMessageType.ResetCompleted) {
      latestReportsByTab.delete(tabId);
    }

    rememberLatestTabMessage(tabId, messageForPanel);
  }

  if (
    message.type === RuntimeMessageType.AnalysisRequested
    || message.type === RuntimeMessageType.ComponentScopeChanged
    || message.type === RuntimeMessageType.LayerVisibilityChanged
    || message.type === RuntimeMessageType.PageContextRequested
    || message.type === RuntimeMessageType.ReaderModeChanged
    || message.type === RuntimeMessageType.ResetRequested
    || message.type === RuntimeMessageType.ViolationFocusChanged
    || message.type === RuntimeMessageType.ViolationFiltersChanged
  ) {
    void forwardToTargetTab(message);

    return false;
  }

  void sendRuntimeMessage(messageForPanel);

  return false;
  });

  extensionApi.runtime.onConnect.addListener(port => {
  if (port.name !== sidePanelPortName) {
    return;
  }

  let connectedTabId: number | undefined;

  port.onMessage.addListener((message: {readonly tabId?: number}) => {
    connectedTabId = message.tabId;
  });

  port.onDisconnect.addListener(() => {
    if (connectedTabId === undefined) {
      return;
    }

    void stopVideoBuffer(connectedTabId);
    latestMessagesByTab.delete(connectedTabId);
    latestReportsByTab.delete(connectedTabId);
    void sendTabMessage(connectedTabId, {
      payload: {},
      tabId: connectedTabId,
      type: RuntimeMessageType.ResetRequested,
    });
  });
  });

  extensionApi.tabs.onActivated.addListener(({tabId}) => {
    activeTabId = tabId;
    void activateSidePanelTab(tabId);
  });

  extensionApi.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (isMeaningfulNavigationUpdate(changeInfo)) {
    void stopVideoBuffer(tabId);
    analyzerInjectedTabs.delete(tabId);
    latestMessagesByTab.delete(tabId);
    latestReportsByTab.delete(tabId);
  }

  if (changeInfo.status === 'loading' || changeInfo.url !== undefined) {
    void sendRuntimeMessage({
      payload: {},
      tabId,
      type: RuntimeMessageType.TabReloaded,
    });
  }

  void enableSidePanelForTab(tabId);
  });

  extensionApi.tabs.onRemoved.addListener(tabId => {
    void stopVideoBuffer(tabId);
    analyzerInjectedTabs.delete(tabId);
    latestMessagesByTab.delete(tabId);
    latestReportsByTab.delete(tabId);
  });
}

async function forwardToTargetTab(message: RuntimeMessage): Promise<void> {
  if (message.tabId !== undefined) {
    const isReady = await ensureTargetTabReady(message.tabId, message);

    if (!isReady) {
      notifyPanelAnalysisFailure(message.tabId, 'Kode Glass cannot access this page. Try a normal http or https tab, then run the scan again.');

      return;
    }

    const sent = await sendTabMessage(message.tabId, message);

    if (!sent && message.type === RuntimeMessageType.AnalysisRequested) {
      notifyPanelAnalysisFailure(message.tabId, 'Could not deliver the scan request to this page. Refresh the page, then run the scan again.');
    }

    return;
  }

  const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});

  if (activeTab?.id === undefined) {
    return;
  }

  const isReady = await ensureTargetTabReady(activeTab.id, message);

  if (!isReady) {
    notifyPanelAnalysisFailure(activeTab.id, 'Kode Glass cannot access this page. Try a normal http or https tab, then run the scan again.');

    return;
  }

  const sent = await sendTabMessage(activeTab.id, message);

  if (!sent && message.type === RuntimeMessageType.AnalysisRequested) {
    notifyPanelAnalysisFailure(activeTab.id, 'Could not deliver the scan request to this page. Refresh the page, then run the scan again.');
  }
}

async function enableSidePanelForOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});

  await Promise.all(tabs.map(tab => tab.id === undefined ? Promise.resolve() : enableSidePanelForTab(tab.id)));
}

async function activateSidePanelTab(tabId: number): Promise<void> {
  await enableSidePanelForTab(tabId);
  await sendRuntimeMessage({
    payload: {tabId},
    type: RuntimeMessageType.ActiveTabChanged,
  });
  await hydratePanelForTab(tabId);
}

async function enableSidePanelForTab(tabId: number): Promise<void> {
  await chrome.sidePanel.setOptions({
    enabled: true,
    path: `${sidePanelPath}?tabId=${tabId}`,
    tabId,
  });
}

async function hydratePanelForTab(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) {
    return;
  }

  await ensureContentScript(tabId);

  const latestMessage = latestMessagesByTab.get(tabId);
  const latestReport = latestReportsByTab.get(tabId);

  if (latestReport) {
    await sendRuntimeMessage(latestReport);
  }

  if (latestMessage && latestMessage.type !== RuntimeMessageType.ReportGenerated) {
    await sendRuntimeMessage(latestMessage);
  }

  await sendTabMessage(tabId, {
    payload: {},
    tabId,
    type: RuntimeMessageType.PageContextRequested,
  });
}

async function ensureContentScript(tabId: number): Promise<boolean> {
  if (await canReachContentScript(tabId)) {
    return true;
  }

  try {
    await chrome.scripting.executeScript({
      files: ['content-script.js'],
      target: {tabId},
    });

    return true;
  } catch {
    return false;
  }
}

async function ensureTargetTabReady(tabId: number, message: RuntimeMessage): Promise<boolean> {
  if (!await ensureContentScript(tabId)) {
    return false;
  }

  if (message.type !== RuntimeMessageType.AnalysisRequested) {
    return true;
  }

  return ensureAnalyzer(tabId);
}

async function ensureAnalyzer(tabId: number): Promise<boolean> {
  if (analyzerInjectedTabs.has(tabId)) {
    return true;
  }

  try {
    await chrome.scripting.executeScript({
      files: ['analysis-runner.js'],
      target: {tabId},
    });
    analyzerInjectedTabs.add(tabId);

    return true;
  } catch {
    return false;
  }
}

async function canReachContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      payload: {},
      tabId,
      type: RuntimeMessageType.PageContextRequested,
    });

    return true;
  } catch {
    return false;
  }
}

async function captureEvidenceImage(
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

  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(windowId, {format: 'png'});

  return {
    fileNameBase: buildEvidenceFileNameBase(message.payload.mode),
    ok: true,
    screenshotDataUrl,
    snapshot,
  };
}

async function requestCaptureBoundsFromTab(
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

async function toggleVideoBuffer(
  message: EvidenceVideoBufferToggledMessage,
): Promise<EvidenceVideoBufferToggleResponse> {
  const tabId = message.tabId ?? activeTabId;

  if (tabId === undefined) {
    return {error: 'No active tab available for video buffering.', ok: false};
  }

  if (!message.payload.enabled) {
    await stopVideoBuffer(tabId);

    return {ok: true};
  }

  try {
    await startVideoBuffer(tabId);

    return {ok: true};
  } catch (error) {
    await stopVideoBuffer(tabId);

    return {error: getErrorMessage(error), ok: false};
  }
}

async function downloadRollbackVideo(
  message: EvidenceVideoRollbackRequestedMessage,
): Promise<EvidenceVideoRollbackResponse> {
  const tabId = message.tabId ?? activeTabId;

  if (tabId === undefined) {
    return {error: 'No active tab available for rollback export.', ok: false};
  }

  const state = videoBuffersByTab.get(tabId);

  if (!state) {
    return {error: 'Video buffer is not running for this tab.', ok: false};
  }

  const cutoff = Date.now() - message.payload.minutes * 60_000;
  const selectedChunks = state.chunks.filter(chunk => chunk.recordedAt >= cutoff).map(chunk => chunk.blob);

  if (!selectedChunks.length) {
    return {error: 'No buffered footage available for the selected rollback window.', ok: false};
  }

  const blob = new Blob(selectedChunks, {type: state.mimeType});
  const objectUrl = URL.createObjectURL(blob);

  try {
    const filename = `${buildEvidenceFileNameBase('rollback')}-${message.payload.minutes}m.webm`;
    await chrome.downloads.download({filename, saveAs: true, url: objectUrl});
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }

  return {ok: true};
}

async function startVideoBuffer(tabId: number): Promise<void> {
  await stopVideoBuffer(tabId);

  const stream = await new Promise<MediaStream>((resolve, reject) => {
    chrome.tabCapture.capture({audio: false, video: true}, capturedStream => {
      if (chrome.runtime.lastError || !capturedStream) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'Failed to start tab capture.'));

        return;
      }

      resolve(capturedStream);
    });
  });

  const mimeType = getPreferredRecorderMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, {mimeType}) : new MediaRecorder(stream);
  const state: TabVideoBufferState = {
    chunks: [],
    mimeType: mimeType || recorder.mimeType || 'video/webm',
    recorder,
    stream,
  };

  recorder.addEventListener('dataavailable', event => {
    if (!event.data || event.data.size === 0) {
      return;
    }

    state.chunks.push({blob: event.data, recordedAt: Date.now()});
    pruneVideoChunks(state);
  });

  recorder.addEventListener('stop', () => {
    stream.getTracks().forEach(track => track.stop());
  });

  recorder.start(videoChunkTimesliceMs);
  videoBuffersByTab.set(tabId, state);
}

async function stopVideoBuffer(tabId: number): Promise<void> {
  const state = videoBuffersByTab.get(tabId);

  if (!state) {
    return;
  }

  videoBuffersByTab.delete(tabId);

  if (state.recorder.state !== 'inactive') {
    state.recorder.stop();
  }

  state.stream.getTracks().forEach(track => track.stop());
}

function pruneVideoChunks(state: TabVideoBufferState): void {
  const cutoff = Date.now() - maxRollbackWindowMs;
  const firstIndexInWindow = state.chunks.findIndex(chunk => chunk.recordedAt >= cutoff);

  if (firstIndexInWindow <= 0) {
    return;
  }

  state.chunks.splice(0, firstIndexInWindow);
}

function getPreferredRecorderMimeType(): string | undefined {
  const preferredMimeTypes = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  return preferredMimeTypes.find(mimeType => MediaRecorder.isTypeSupported(mimeType));
}

function buildEvidenceFileNameBase(mode: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  return `kode-glass-${mode}-${timestamp}`;
}

function notifyPanelAnalysisFailure(tabId: number, message: string): void {
  void sendRuntimeMessage({
    payload: {message},
    tabId,
    type: RuntimeMessageType.AnalysisFailed,
  });
}

function isMeaningfulNavigationUpdate(changeInfo: {readonly status?: string; readonly url?: string}): boolean {
  return changeInfo.status === 'loading' || changeInfo.url !== undefined;
}

async function sendRuntimeMessage(message: RuntimeMessage): Promise<boolean> {
  try {
    await chrome.runtime.sendMessage(message);

    return true;
  } catch {
    return false;
  }
}

async function sendTabMessage(tabId: number, message: RuntimeMessage): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, message);

    return true;
  } catch {
    return false;
  }
}

function speakReaderLine(payload: ReaderSpeakPayload): void {
  const {readerMode, text} = payload;

  if (!readerMode.speak || !readerMode.enabled || !text.trim()) {
    return;
  }

  chrome.tts.stop();
  chrome.tts.getVoices(voices => {
    const voiceName = resolveChromeTtsVoiceName(voices, readerMode);

    chrome.tts.speak(text, {
      gender: 'female',
      lang: 'en-US',
      pitch: 1,
      rate: readerMode.rate ?? 0.92,
      ...(voiceName ? {voiceName} : {}),
    });
  });
}

function resolveChromeTtsVoiceName(
  voices: readonly chrome.tts.TtsVoice[],
  readerMode: ReaderSpeakPayload['readerMode'],
): string | undefined {
  const preferredName = readerMode.voiceName?.toLowerCase() ?? '';

  if (preferredName) {
    const exact = voices.find(voice => voice.voiceName === readerMode.voiceName);

    if (exact?.voiceName) {
      return exact.voiceName;
    }

    const fuzzy = voices.find(
      voice =>
        voice.lang?.toLowerCase().startsWith('en')
        && voice.voiceName?.toLowerCase().includes(preferredName),
    );

    if (fuzzy?.voiceName) {
      return fuzzy.voiceName;
    }
  }

  const googleUs = voices.find(
    voice =>
      voice.lang?.toLowerCase().startsWith('en-us')
      && voice.voiceName !== undefined
      && /google/i.test(voice.voiceName),
  );

  return googleUs?.voiceName;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rememberLatestTabMessage(tabId: number, message: RuntimeMessage): void {
  const latestMessage = latestMessagesByTab.get(tabId);

  if (message.type === RuntimeMessageType.ResetCompleted) {
    latestMessagesByTab.delete(tabId);

    return;
  }

  if (message.type === RuntimeMessageType.ContentReady && latestMessage?.type === RuntimeMessageType.ReportGenerated) {
    return;
  }

  latestMessagesByTab.set(tabId, message);
}
