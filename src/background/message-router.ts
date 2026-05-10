import {getErrorMessage} from '../shared/error-boundary';
import {logger} from '../shared/logger';
import {
  RuntimeMessageType,
  type EvidenceImageCaptureResponse,
  type EvidenceVideoBufferToggleResponse,
  type EvidenceVideoRollbackResponse,
  type JiraAuthStatusResponse,
  type JiraConnectResponse,
  type JiraDisconnectResponse,
  type JiraIssueCreateResponse,
  type JiraIssueTypesResponse,
  type JiraProjectsResponse,
  type JiraSitesResponse,
  type ReaderVoicesResponse,
  type ReaderSpeakPayload,
  type ReportGeneratedMessage,
  type RuntimeMessage,
} from '../shared/messages';
import {captureEvidenceImage} from './screenshot-capture';
import {toggleVideoBuffer, downloadRollbackVideo, stopVideoBuffer} from './video-recorder';
import {isInternalMessage, isPortConnection} from '../shared/message-validator';
import {
  getJiraAuthStatus,
  connectJira,
  disconnectJira,
  getJiraSites,
  getJiraProjects,
  getJiraIssueTypes,
  createJiraIssue,
} from './jira-oauth';

const latestMessagesByTab = new Map<number, RuntimeMessage>();
const latestReportsByTab = new Map<number, ReportGeneratedMessage>();
const analyzerInjectedTabs = new Set<number>();
export let activeTabId: number | undefined;
const sidePanelPath = 'side-panel.html';
const extensionApi = globalThis.chrome;

export function setupBackgroundListeners(): void {
  if (!extensionApi?.runtime || !extensionApi?.tabs) {
    logger.warn('Extension APIs unavailable.');
    return;
  }

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
  if (!isInternalMessage(sender)) {
    return false;
  }

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

  if (message.type === RuntimeMessageType.JiraAuthStatusRequested) {
    void getJiraAuthStatus()
      .then(response => sendResponse(response))
      .catch(error => sendResponse({session: {error: getErrorMessage(error), status: 'disconnected'}} satisfies JiraAuthStatusResponse));

    return true;
  }

  if (message.type === RuntimeMessageType.JiraConnectRequested) {
    void connectJira(message)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({error: getErrorMessage(error), ok: false} satisfies JiraConnectResponse));

    return true;
  }

  if (message.type === RuntimeMessageType.JiraDisconnectRequested) {
    void disconnectJira()
      .then(response => sendResponse(response))
      .catch(error => sendResponse({error: getErrorMessage(error), ok: false} satisfies JiraDisconnectResponse));

    return true;
  }

  if (message.type === RuntimeMessageType.JiraSitesRequested) {
    void getJiraSites()
      .then(response => sendResponse(response))
      .catch(error => sendResponse({error: getErrorMessage(error), ok: false, sites: []} satisfies JiraSitesResponse));

    return true;
  }

  if (message.type === RuntimeMessageType.JiraProjectsRequested) {
    void getJiraProjects()
      .then(response => sendResponse(response))
      .catch(error => sendResponse({error: getErrorMessage(error), ok: false, projects: []} satisfies JiraProjectsResponse));

    return true;
  }

  if (message.type === RuntimeMessageType.JiraIssueTypesRequested) {
    void getJiraIssueTypes(message.payload.projectKey)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({error: getErrorMessage(error), issueTypes: [], ok: false} satisfies JiraIssueTypesResponse));

    return true;
  }

  if (message.type === RuntimeMessageType.JiraIssueCreateRequested) {
    void createJiraIssue(message)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({error: getErrorMessage(error), ok: false} satisfies JiraIssueCreateResponse));

    return true;
  }

  if (message.type === RuntimeMessageType.ReaderVoicesRequested) {
    chrome.tts.getVoices(voices => {
      sendResponse({
        ok: true,
        voices: voices.map(voice => ({
          gender: voice.gender,
          label: `${voice.voiceName ?? 'System'} (${voice.lang ?? 'unknown'})`,
          lang: voice.lang ?? '',
          localService: voice.remote !== true,
          name: voice.voiceName ?? '',
          remote: voice.remote,
          voiceURI: voice.voiceName ?? '',
        })),
      } satisfies ReaderVoicesResponse);
    });

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

  if (message.type === RuntimeMessageType.ReaderSpeechControlRequested) {
    if (message.payload.action === 'pause') {
      chrome.tts.pause();
    } else if (message.payload.action === 'resume') {
      chrome.tts.resume();
    } else {
      readerSpeechQueue.length = 0;
      readerCoalescedUtterance = undefined;
      readerSpeaking = false;
      chrome.tts.stop();
    }

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

    if (message.type === RuntimeMessageType.TabReloaded) {
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
    || message.type === RuntimeMessageType.ReaderCommandRequested
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
  if (!isPortConnection(port)) {
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
    void resetContentScriptForNavigation(tabId);
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

export async function forwardToTargetTab(message: RuntimeMessage): Promise<void> {
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

export async function resetContentScriptForNavigation(tabId: number): Promise<void> {
  await sendTabMessage(tabId, {
    payload: {},
    tabId,
    type: RuntimeMessageType.ResetRequested,
  });
}

export async function enableSidePanelForOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});

  await Promise.all(tabs.map(tab => tab.id === undefined ? Promise.resolve() : enableSidePanelForTab(tab.id)));
}

export async function activateSidePanelTab(tabId: number): Promise<void> {
  await enableSidePanelForTab(tabId);
  await sendRuntimeMessage({
    payload: {tabId},
    type: RuntimeMessageType.ActiveTabChanged,
  });
  await hydratePanelForTab(tabId);
}

export async function enableSidePanelForTab(tabId: number): Promise<void> {
  await chrome.sidePanel.setOptions({
    enabled: true,
    path: `${sidePanelPath}?tabId=${tabId}`,
    tabId,
  });
}

export async function hydratePanelForTab(tabId: number | undefined): Promise<void> {
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

export async function ensureContentScript(tabId: number): Promise<boolean> {
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

export async function ensureTargetTabReady(tabId: number, message: RuntimeMessage): Promise<boolean> {
  if (!await ensureContentScript(tabId)) {
    return false;
  }

  if (message.type !== RuntimeMessageType.AnalysisRequested) {
    return true;
  }

  return ensureAnalyzer(tabId);
}

export async function ensureAnalyzer(tabId: number): Promise<boolean> {
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

export async function canReachContentScript(tabId: number): Promise<boolean> {
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

export function buildEvidenceFileNameBase(mode: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  return `kode-glass-${mode}-${timestamp}`;
}

export function notifyPanelAnalysisFailure(tabId: number, message: string): void {
  void sendRuntimeMessage({
    payload: {message},
    tabId,
    type: RuntimeMessageType.AnalysisFailed,
  });
}

export function isMeaningfulNavigationUpdate(changeInfo: {readonly status?: string; readonly url?: string}): boolean {
  return changeInfo.status === 'loading' || changeInfo.url !== undefined;
}

export async function sendRuntimeMessage(message: RuntimeMessage): Promise<boolean> {
  try {
    await chrome.runtime.sendMessage(message);

    return true;
  } catch {
    return false;
  }
}

export async function sendTabMessage(tabId: number, message: RuntimeMessage): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, message);

    return true;
  } catch {
    return false;
  }
}

let readerSpeaking = false;
let readerCoalescedUtterance: ReaderSpeakPayload | undefined;
const readerSpeechQueue: ReaderSpeakPayload[] = [];

export function speakReaderLine(payload: ReaderSpeakPayload): void {
  const {readerMode, text} = payload;

  if (!readerMode.speak || !readerMode.enabled || !text.trim()) {
    return;
  }

  const policy = readerMode.interruptPolicy ?? 'coalesce';

  if (policy === 'interrupt') {
    readerSpeechQueue.length = 0;
    readerCoalescedUtterance = undefined;
    readerSpeaking = false;
    chrome.tts.stop();
    speakNow(payload);
    return;
  }

  if (policy === 'queue') {
    readerSpeechQueue.push(payload);
    if (!readerSpeaking) {
      playNextReaderSpeech();
    }
    return;
  }

  readerCoalescedUtterance = payload;

  if (!readerSpeaking) {
    playNextReaderSpeech();
  }
}

function playNextReaderSpeech(): void {
  const next = readerSpeechQueue.shift() ?? readerCoalescedUtterance;

  readerCoalescedUtterance = undefined;

  if (!next) {
    readerSpeaking = false;
    return;
  }

  speakNow(next);
}

function speakNow(payload: ReaderSpeakPayload): void {
  const {readerMode, text} = payload;

  readerSpeaking = true;
  chrome.tts.getVoices(voices => {
    const voiceName = resolveChromeTtsVoiceName(voices, readerMode);
    const speakOptions: chrome.tts.TtsOptions = {
      onEvent: event => {
        if (event.type === 'cancelled' || event.type === 'end' || event.type === 'error' || event.type === 'interrupted') {
          readerSpeaking = false;
          playNextReaderSpeech();
        }
      },
      pitch: 1,
      rate: readerMode.rate ?? 0.92,
      ...(voiceName ? {voiceName} : {}),
    };

    if (!readerMode.voiceName) {
      speakOptions.gender = 'female';
    }

    if (!readerMode.voiceURI && !readerMode.voiceName) {
      speakOptions.lang = 'en-US';
    }

    chrome.tts.speak(text, speakOptions);
  });
}

export function resolveChromeTtsVoiceName(
  voices: readonly chrome.tts.TtsVoice[],
  readerMode: ReaderSpeakPayload['readerMode'],
): string | undefined {
  const preferredUri = readerMode.voiceURI?.toLowerCase() ?? '';
  if (preferredUri) {
    const byUri = voices.find(
      voice => (voice.voiceName ?? '').toLowerCase() === preferredUri || (voice.extensionId ?? '').toLowerCase() === preferredUri,
    );

    if (byUri?.voiceName) {
      return byUri.voiceName;
    }
  }

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

export async function wait(durationMs: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, durationMs));
}

export function rememberLatestTabMessage(tabId: number, message: RuntimeMessage): void {
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
