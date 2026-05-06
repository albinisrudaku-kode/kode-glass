import {
  RuntimeMessageType,
  type EvidenceImageCaptureRequestedMessage,
  type EvidenceImageCaptureResponse,
  type EvidenceVideoBufferToggledMessage,
  type EvidenceVideoBufferToggleResponse,
  type EvidenceVideoRollbackRequestedMessage,
  type EvidenceVideoRollbackResponse,
  type JiraAuthStatusResponse,
  type JiraConnectRequestedMessage,
  type JiraConnectResponse,
  type JiraDisconnectResponse,
  type JiraIssueCreateRequestedMessage,
  type JiraIssueCreateResponse,
  type JiraIssueTypesResponse,
  type JiraProjectsResponse,
  type JiraSitesResponse,
  type ReaderSpeakPayload,
  type ReportGeneratedMessage,
  type RuntimeMessage,
} from '../shared/messages';
import type {CaptureBoundsSnapshot, JiraSiteOption} from '../shared/accessibility-report';

const latestMessagesByTab = new Map<number, RuntimeMessage>();
const latestReportsByTab = new Map<number, ReportGeneratedMessage>();
const analyzerInjectedTabs = new Set<number>();
const videoBuffersByTab = new Map<number, TabVideoBufferState>();
let activeTabId: number | undefined;
const sidePanelPath = 'side-panel.html';
const sidePanelPortName = 'kode-glass-side-panel';
const videoChunkTimesliceMs = 1000;
const maxRollbackWindowMs = 5 * 60 * 1000;
const visibleTabCaptureCooldownMs = 650;
const jiraStorageKey = 'jira.oauth.session';
const jiraScope = 'read:me read:jira-user read:jira-work write:jira-work offline_access';
const jiraAuthAudience = 'api.atlassian.com';
let lastVisibleTabCaptureAt = 0;

interface JiraOAuthSessionStorage {
  readonly accessToken: string;
  readonly accountId?: string;
  readonly clientId: string;
  readonly displayName?: string;
  readonly expiresAt: number;
  readonly refreshToken?: string;
  readonly site?: JiraSiteOption;
}

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

async function resetContentScriptForNavigation(tabId: number): Promise<void> {
  await sendTabMessage(tabId, {
    payload: {},
    tabId,
    type: RuntimeMessageType.ResetRequested,
  });
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

  await waitForVisibleTabCaptureSlot();
  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(windowId, {format: 'png'});

  return {
    fileNameBase: buildEvidenceFileNameBase(message.payload.mode),
    ok: true,
    screenshotDataUrl,
    snapshot,
  };
}

async function waitForVisibleTabCaptureSlot(): Promise<void> {
  const elapsedMs = Date.now() - lastVisibleTabCaptureAt;
  const delayMs = Math.max(0, visibleTabCaptureCooldownMs - elapsedMs);

  if (delayMs > 0) {
    await wait(delayMs);
  }

  lastVisibleTabCaptureAt = Date.now();
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

async function getJiraAuthStatus(): Promise<JiraAuthStatusResponse> {
  const session = await readStoredJiraSession();

  if (!session) {
    return {session: {status: 'disconnected'}};
  }

  return {
    session: {
      accountId: session.accountId,
      displayName: session.displayName,
      issueTypeId: undefined,
      issueTypeName: undefined,
      projectId: undefined,
      projectKey: undefined,
      site: session.site,
      status: 'connected',
    },
  };
}

async function connectJira(
  message: JiraConnectRequestedMessage,
): Promise<JiraConnectResponse> {
  const clientId = message.payload.clientId.trim();

  if (!clientId) {
    return {error: 'Atlassian client ID is required.', ok: false};
  }

  const identityApi = chrome.identity;

  if (!identityApi) {
    return {error: 'Chrome identity API is unavailable.', ok: false};
  }

  const redirectUri = identityApi.getRedirectURL('jira-oauth');
  const verifier = createPkceVerifier();
  const challenge = await createPkceChallenge(verifier);
  const state = crypto.randomUUID();
  const authUrl = new URL('https://auth.atlassian.com/authorize');
  authUrl.searchParams.set('audience', jiraAuthAudience);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('scope', jiraScope);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const callbackUrl = await identityApi.launchWebAuthFlow({
    interactive: true,
    url: authUrl.toString(),
  });

  if (!callbackUrl) {
    return {error: 'Jira authentication was cancelled.', ok: false};
  }

  const callback = new URL(callbackUrl);
  const returnedState = callback.searchParams.get('state');
  const authError = callback.searchParams.get('error');

  if (authError) {
    return {error: `Jira auth failed: ${authError}`, ok: false};
  }

  if (!returnedState || returnedState !== state) {
    return {error: 'Invalid Jira OAuth state returned.', ok: false};
  }

  const code = callback.searchParams.get('code');

  if (!code) {
    return {error: 'Jira authorization code was not returned.', ok: false};
  }

  const token = await exchangeAuthCodeForToken({clientId, code, redirectUri, verifier});
  const site = await getDefaultJiraSite(token.access_token);
  const profile = await getJiraMyself(token.access_token, site.id);
  const storedSession: JiraOAuthSessionStorage = {
    accessToken: token.access_token,
    accountId: profile.accountId,
    clientId,
    displayName: profile.displayName,
    expiresAt: Date.now() + Math.max(30, token.expires_in) * 1000,
    refreshToken: token.refresh_token,
    site,
  };
  await writeStoredJiraSession(storedSession);

  return {
    ok: true,
    session: {
      accountId: profile.accountId,
      displayName: profile.displayName,
      site,
      status: 'connected',
    },
  };
}

async function disconnectJira(): Promise<JiraDisconnectResponse> {
  await chrome.storage.local.remove(jiraStorageKey);

  return {ok: true};
}

async function getJiraSites(): Promise<JiraSitesResponse> {
  const accessToken = await getValidJiraAccessToken();

  if (!accessToken) {
    return {error: 'Connect Jira first to load available sites.', ok: false, sites: []};
  }

  try {
    const sites = await fetchJiraSites(accessToken);

    return {ok: true, sites};
  } catch (error) {
    return {error: getErrorMessage(error), ok: false, sites: []};
  }
}

async function getJiraProjects(): Promise<JiraProjectsResponse> {
  const session = await getValidatedStoredSession();

  if (!session?.site) {
    return {error: 'Connect Jira first to load projects.', ok: false, projects: []};
  }

  const response = await fetchJiraApi<{
    readonly values?: ReadonlyArray<{readonly id: string; readonly key: string; readonly name: string}>;
  }>(session.accessToken, session.site.id, '/rest/api/3/project/search?maxResults=100');

  return {
    ok: true,
    projects: (response.values ?? []).map(project => ({
      id: project.id,
      key: project.key,
      name: project.name,
    })),
  };
}

async function getJiraIssueTypes(projectKey: string): Promise<JiraIssueTypesResponse> {
  const session = await getValidatedStoredSession();

  if (!session?.site) {
    return {error: 'Connect Jira first to load issue types.', issueTypes: [], ok: false};
  }

  const encodedProjectKey = encodeURIComponent(projectKey);
  const metadata = await fetchJiraApi<{
    readonly projects?: ReadonlyArray<{
      readonly issuetypes?: ReadonlyArray<{readonly id: string; readonly name: string}>;
    }>;
  }>(
    session.accessToken,
    session.site.id,
    `/rest/api/3/issue/createmeta?projectKeys=${encodedProjectKey}&expand=projects.issuetypes`,
  );
  const issueTypes = metadata.projects?.[0]?.issuetypes ?? [];

  return {
    issueTypes: issueTypes.map(issueType => ({id: issueType.id, name: issueType.name})),
    ok: true,
  };
}

async function createJiraIssue(
  message: JiraIssueCreateRequestedMessage,
): Promise<JiraIssueCreateResponse> {
  const session = await getValidatedStoredSession();

  if (!session?.site) {
    return {error: 'Connect Jira before creating tasks.', ok: false};
  }

  const issueResult = await fetchJiraApi<{readonly key: string}>(
    session.accessToken,
    session.site.id,
    '/rest/api/3/issue',
    {
      body: JSON.stringify({
        fields: {
          description: {
            content: [
              {
                content: [{text: message.payload.description, type: 'text'}],
                type: 'paragraph',
              },
            ],
            type: 'doc',
            version: 1,
          },
          issuetype: {id: message.payload.issueTypeId},
          project: {key: message.payload.projectKey},
          summary: message.payload.summary,
        },
      }),
      method: 'POST',
    },
  );

  if (message.payload.evidenceImageDataUrls.length) {
    await uploadJiraAttachments(
      session.accessToken,
      session.site.id,
      issueResult.key,
      message.payload.evidenceImageDataUrls,
    );
  }

  return {
    issueKey: issueResult.key,
    issueUrl: `${session.site.url}/browse/${issueResult.key}`,
    ok: true,
  };
}

async function uploadJiraAttachments(
  accessToken: string,
  siteId: string,
  issueKey: string,
  evidenceImageDataUrls: readonly string[],
): Promise<void> {
  for (const [index, evidenceImageDataUrl] of evidenceImageDataUrls.entries()) {
    const blob = await fetch(evidenceImageDataUrl).then(response => response.blob());
    const formData = new FormData();
    formData.append('file', blob, `kode-glass-evidence-${index + 1}.png`);

    await fetchJiraApi(
      accessToken,
      siteId,
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`,
      {
        body: formData,
        headers: {'X-Atlassian-Token': 'no-check'},
        method: 'POST',
      },
    );
  }
}

async function fetchJiraApi<TResponse>(
  accessToken: string,
  siteId: string,
  path: string,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(`https://api.atlassian.com/ex/jira/${siteId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body instanceof FormData ? {} : {'Content-Type': 'application/json'}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Jira request failed (${response.status}): ${await response.text()}`);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return response.json() as Promise<TResponse>;
}

async function fetchJiraSites(accessToken: string): Promise<readonly JiraSiteOption[]> {
  const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: {Authorization: `Bearer ${accessToken}`},
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch Jira sites (${response.status}).`);
  }

  const resources = await response.json() as ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly url: string;
  }>;

  return resources.map(resource => ({id: resource.id, name: resource.name, url: resource.url}));
}

async function getDefaultJiraSite(accessToken: string): Promise<JiraSiteOption> {
  const sites = await fetchJiraSites(accessToken);

  if (!sites.length) {
    throw new Error('No Jira cloud sites are accessible for this Atlassian account.');
  }

  const [firstSite] = sites;

  return firstSite!;
}

async function getJiraMyself(accessToken: string, siteId: string): Promise<{
  readonly accountId: string;
  readonly displayName: string;
}> {
  return fetchJiraApi<{readonly accountId: string; readonly displayName: string}>(
    accessToken,
    siteId,
    '/rest/api/3/myself',
  );
}

async function exchangeAuthCodeForToken(input: {
  readonly clientId: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly verifier: string;
}): Promise<{
  readonly access_token: string;
  readonly expires_in: number;
  readonly refresh_token?: string;
}> {
  const response = await fetch('https://auth.atlassian.com/oauth/token', {
    body: JSON.stringify({
      client_id: input.clientId,
      code: input.code,
      code_verifier: input.verifier,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
    }),
    headers: {'Content-Type': 'application/json'},
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Jira token exchange failed (${response.status}).`);
  }

  return response.json() as Promise<{
    readonly access_token: string;
    readonly expires_in: number;
    readonly refresh_token?: string;
  }>;
}

async function refreshJiraToken(session: JiraOAuthSessionStorage): Promise<JiraOAuthSessionStorage> {
  if (!session.refreshToken) {
    throw new Error('Jira session expired. Reconnect Jira to continue.');
  }

  const response = await fetch('https://auth.atlassian.com/oauth/token', {
    body: JSON.stringify({
      client_id: session.clientId,
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
    }),
    headers: {'Content-Type': 'application/json'},
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Jira token refresh failed (${response.status}).`);
  }

  const payload = await response.json() as {
    readonly access_token: string;
    readonly expires_in: number;
    readonly refresh_token?: string;
  };

  const refreshedSession: JiraOAuthSessionStorage = {
    ...session,
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(30, payload.expires_in) * 1000,
    refreshToken: payload.refresh_token ?? session.refreshToken,
  };
  await writeStoredJiraSession(refreshedSession);

  return refreshedSession;
}

async function getValidatedStoredSession(): Promise<JiraOAuthSessionStorage | null> {
  const session = await readStoredJiraSession();

  if (!session) {
    return null;
  }

  if (session.expiresAt > Date.now() + 15_000) {
    return session;
  }

  return refreshJiraToken(session);
}

async function getValidJiraAccessToken(): Promise<string | null> {
  const session = await getValidatedStoredSession();

  return session?.accessToken ?? null;
}

async function readStoredJiraSession(): Promise<JiraOAuthSessionStorage | null> {
  const storage = await chrome.storage.local.get(jiraStorageKey);
  const storedSession = storage[jiraStorageKey] as JiraOAuthSessionStorage | undefined;

  return storedSession ?? null;
}

async function writeStoredJiraSession(session: JiraOAuthSessionStorage): Promise<void> {
  await chrome.storage.local.set({[jiraStorageKey]: session});
}

function createPkceVerifier(): string {
  const randomValues = crypto.getRandomValues(new Uint8Array(32));

  return toBase64Url(randomValues);
}

async function createPkceChallenge(verifier: string): Promise<string> {
  const encodedVerifier = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encodedVerifier);

  return toBase64Url(new Uint8Array(digest));
}

function toBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));

  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
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

async function wait(durationMs: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, durationMs));
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
