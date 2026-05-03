import {RuntimeMessageType, type RuntimeMessage} from '../shared/messages';

const latestMessagesByTab = new Map<number, RuntimeMessage>();
const analyzerInjectedTabs = new Set<number>();
let activeTabId: number | undefined;
const sidePanelPath = 'side-panel.html';
const sidePanelPortName = 'kode-glass-side-panel';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: false});
  void enableSidePanelForOpenTabs();
});

chrome.runtime.onStartup.addListener(() => {
  void enableSidePanelForOpenTabs();
});

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) {
    return;
  }

  activeTabId = tab.id;
  void enableSidePanelForTab(tab.id);
  void ensureContentScript(tab.id);
  void chrome.sidePanel.open({tabId: tab.id}).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender) => {
  const tabId = sender.tab?.id;
  const messageForPanel = tabId === undefined ? message : {...message, tabId};

  if (message.type === RuntimeMessageType.PanelOpened) {
    void hydratePanelForTab(message.tabId);

    return false;
  }

  if (tabId !== undefined && message.type !== RuntimeMessageType.ActiveNodeChanged) {
    rememberLatestTabMessage(tabId, messageForPanel);
  }

  if (
    message.type === RuntimeMessageType.AnalysisRequested
    || message.type === RuntimeMessageType.LayerVisibilityChanged
    || message.type === RuntimeMessageType.PageContextRequested
    || message.type === RuntimeMessageType.ReaderModeChanged
    || message.type === RuntimeMessageType.ResetRequested
    || message.type === RuntimeMessageType.ViolationFiltersChanged
  ) {
    void forwardToTargetTab(message);

    return false;
  }

  void chrome.runtime.sendMessage(messageForPanel).catch(() => undefined);

  return false;
});

chrome.runtime.onConnect.addListener(port => {
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

    if (connectedTabId !== activeTabId) {
      return;
    }

    latestMessagesByTab.delete(connectedTabId);
    void chrome.tabs.sendMessage(connectedTabId, {
      payload: {},
      tabId: connectedTabId,
      type: RuntimeMessageType.ResetRequested,
    }).catch(() => undefined);
  });
});

chrome.tabs.onActivated.addListener(({tabId}) => {
  activeTabId = tabId;
  void activateSidePanelTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId) => {
  analyzerInjectedTabs.delete(tabId);
  latestMessagesByTab.delete(tabId);
  void enableSidePanelForTab(tabId);
});

async function forwardToTargetTab(message: RuntimeMessage): Promise<void> {
  if (message.tabId !== undefined) {
    const isReady = await ensureTargetTabReady(message.tabId, message);

    if (!isReady) {
      notifyPanelAnalysisFailure(message.tabId, 'Kode Glass cannot access this page. Try a normal http or https tab, then run the scan again.');

      return;
    }

    await chrome.tabs.sendMessage(message.tabId, message).catch(() => undefined);

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

  await chrome.tabs.sendMessage(activeTab.id, message).catch(() => undefined);
}

async function enableSidePanelForOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});

  await Promise.all(tabs.map(tab => tab.id === undefined ? Promise.resolve() : enableSidePanelForTab(tab.id)));
}

async function activateSidePanelTab(tabId: number): Promise<void> {
  await enableSidePanelForTab(tabId);
  await chrome.runtime.sendMessage({
    payload: {tabId},
    type: RuntimeMessageType.ActiveTabChanged,
  }).catch(() => undefined);
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

  if (latestMessage) {
    await chrome.runtime.sendMessage(latestMessage).catch(() => undefined);
  }

  await chrome.tabs.sendMessage(tabId, {
    payload: {},
    tabId,
    type: RuntimeMessageType.PageContextRequested,
  }).catch(() => undefined);
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

function notifyPanelAnalysisFailure(tabId: number, message: string): void {
  void chrome.runtime.sendMessage({
    payload: {message},
    tabId,
    type: RuntimeMessageType.AnalysisFailed,
  }).catch(() => undefined);
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
