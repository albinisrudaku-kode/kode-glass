import {RuntimeMessageType, type RuntimeMessage} from '../shared/messages';

const latestMessagesByTab = new Map<number, RuntimeMessage>();

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true});
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender) => {
  const tabId = sender.tab?.id;
  const messageForPanel = tabId === undefined ? message : {...message, tabId};

  if (tabId !== undefined && message.type !== RuntimeMessageType.ActiveNodeChanged) {
    latestMessagesByTab.set(tabId, messageForPanel);
  }

  if (
    message.type === RuntimeMessageType.AnalysisRequested
    || message.type === RuntimeMessageType.LayerVisibilityChanged
    || message.type === RuntimeMessageType.ReaderModeChanged
    || message.type === RuntimeMessageType.ResetRequested
  ) {
    void forwardToTargetTab(message);

    return false;
  }

  void chrome.runtime.sendMessage(messageForPanel).catch(() => undefined);

  return false;
});

chrome.tabs.onActivated.addListener(({tabId}) => {
  const latestMessage = latestMessagesByTab.get(tabId);

  if (latestMessage) {
    void chrome.runtime.sendMessage(latestMessage).catch(() => undefined);
  }
});

async function forwardToTargetTab(message: RuntimeMessage): Promise<void> {
  if (message.tabId !== undefined) {
    await chrome.tabs.sendMessage(message.tabId, message).catch(() => undefined);

    return;
  }

  const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});

  if (activeTab?.id === undefined) {
    return;
  }

  await chrome.tabs.sendMessage(activeTab.id, message).catch(() => undefined);
}
