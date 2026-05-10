import {getErrorMessage} from '../shared/error-boundary';
import {
  type JiraAuthStatusResponse,
  type JiraConnectRequestedMessage,
  type JiraConnectResponse,
  type JiraDisconnectResponse,
  type JiraIssueCreateRequestedMessage,
  type JiraIssueCreateResponse,
  type JiraIssueTypesResponse,
  type JiraProjectsResponse,
  type JiraSitesResponse,
} from '../shared/messages';
import type {JiraSiteOption} from '../shared/accessibility-report';

declare const __ATLASSIAN_OAUTH_CLIENT_SECRET__: string | undefined;

const jiraStorageKey = 'jira.oauth.session';
const jiraScope = 'read:me read:jira-user read:jira-work write:jira-work';
const jiraAuthAudience = 'api.atlassian.com';

export interface JiraOAuthSessionStorage {
  readonly accessToken: string;
  readonly accountId?: string;
  readonly clientId: string;
  readonly displayName?: string;
  readonly expiresAt: number;
  readonly refreshToken?: string;
  readonly site?: JiraSiteOption;
}

export async function getJiraAuthStatus(): Promise<JiraAuthStatusResponse> {
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

export async function connectJira(
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

  const token = await exchangeAuthCodeForToken({
    clientId,
    clientSecret: getAtlassianClientSecret(),
    code,
    redirectUri,
    verifier,
  });
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

export async function disconnectJira(): Promise<JiraDisconnectResponse> {
  await chrome.storage.local.remove(jiraStorageKey);

  return {ok: true};
}

export async function getJiraSites(): Promise<JiraSitesResponse> {
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

export async function getJiraProjects(): Promise<JiraProjectsResponse> {
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

export async function getJiraIssueTypes(projectKey: string): Promise<JiraIssueTypesResponse> {
  const session = await getValidatedStoredSession();

  if (!session?.site) {
    return {error: 'Connect Jira first to load issue types.', issueTypes: [], ok: false};
  }

  const encodedProjectKey = encodeURIComponent(projectKey);
  const metadata = await fetchJiraApi<{
    readonly projects?: ReadonlyArray<{
      readonly issuetypes?: ReadonlyArray<{readonly id: string; readonly name: string; readonly subtask?: boolean}>;
    }>;
  }>(
    session.accessToken,
    session.site.id,
    `/rest/api/3/issue/createmeta?projectKeys=${encodedProjectKey}&expand=projects.issuetypes`,
  );
  const issueTypes = metadata.projects?.[0]?.issuetypes ?? [];

  return {
    issueTypes: issueTypes.map(issueType => ({
      id: issueType.id,
      isSubtask: issueType.subtask === true,
      name: issueType.name,
    })),
    ok: true,
  };
}

export async function createJiraIssue(
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
          ...(message.payload.parentIssueKey ? {parent: {key: message.payload.parentIssueKey}} : {}),
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

  if (message.payload.linkIssueKey) {
    await fetchJiraApi(
      session.accessToken,
      session.site.id,
      '/rest/api/3/issueLink',
      {
        body: JSON.stringify({
          inwardIssue: {key: message.payload.linkIssueKey},
          outwardIssue: {key: issueResult.key},
          type: {name: message.payload.linkTypeName || 'Relates'},
        }),
        method: 'POST',
      },
    );
  }

  return {
    issueKey: issueResult.key,
    issueUrl: `${session.site.url}/browse/${issueResult.key}`,
    ok: true,
  };
}

export async function uploadJiraAttachments(
  accessToken: string,
  siteId: string,
  issueKey: string,
  evidenceImageDataUrls: readonly string[],
): Promise<void> {
  for (const [index, evidenceImageDataUrl] of evidenceImageDataUrls.entries()) {
    const blob = dataUrlToBlob(evidenceImageDataUrl);
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

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);

  if (!match) {
    throw new Error('Invalid evidence image format.');
  }

  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], {type: mimeType});
}

export async function fetchJiraApi<TResponse>(
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

export async function fetchJiraSites(accessToken: string): Promise<readonly JiraSiteOption[]> {
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

export async function getDefaultJiraSite(accessToken: string): Promise<JiraSiteOption> {
  const sites = await fetchJiraSites(accessToken);

  if (!sites.length) {
    throw new Error('No Jira cloud sites are accessible for this Atlassian account.');
  }

  const [firstSite] = sites;

  return firstSite!;
}

export async function getJiraMyself(accessToken: string, siteId: string): Promise<{
  readonly accountId: string;
  readonly displayName: string;
}> {
  return fetchJiraApi<{readonly accountId: string; readonly displayName: string}>(
    accessToken,
    siteId,
    '/rest/api/3/myself',
  );
}

export async function exchangeAuthCodeForToken(input: {
  readonly clientId: string;
  readonly clientSecret?: string;
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
      ...(input.clientSecret ? {client_secret: input.clientSecret} : {}),
      code: input.code,
      code_verifier: input.verifier,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
    }),
    headers: {'Content-Type': 'application/json'},
    method: 'POST',
  });

  if (!response.ok) {
    const details = await readOAuthErrorDetails(response);
    throw new Error(`Jira token exchange failed (${response.status}).${details ? ` ${details}` : ''}`);
  }

  return response.json() as Promise<{
    readonly access_token: string;
    readonly expires_in: number;
    readonly refresh_token?: string;
  }>;
}

export async function refreshJiraToken(session: JiraOAuthSessionStorage): Promise<JiraOAuthSessionStorage> {
  if (!session.refreshToken) {
    throw new Error('Jira session expired. Reconnect Jira to continue.');
  }

  const response = await fetch('https://auth.atlassian.com/oauth/token', {
    body: JSON.stringify({
      client_id: session.clientId,
      ...(getAtlassianClientSecret() ? {client_secret: getAtlassianClientSecret()} : {}),
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
    }),
    headers: {'Content-Type': 'application/json'},
    method: 'POST',
  });

  if (!response.ok) {
    const details = await readOAuthErrorDetails(response);
    throw new Error(`Jira token refresh failed (${response.status}).${details ? ` ${details}` : ''}`);
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

export async function getValidatedStoredSession(): Promise<JiraOAuthSessionStorage | null> {
  const session = await readStoredJiraSession();

  if (!session) {
    return null;
  }

  if (session.expiresAt > Date.now() + 15_000) {
    return session;
  }

  return refreshJiraToken(session);
}

export async function getValidJiraAccessToken(): Promise<string | null> {
  const session = await getValidatedStoredSession();

  return session?.accessToken ?? null;
}

export async function readStoredJiraSession(): Promise<JiraOAuthSessionStorage | null> {
  const storage = await chrome.storage.local.get(jiraStorageKey);
  const storedSession = storage[jiraStorageKey] as JiraOAuthSessionStorage | undefined;

  return storedSession ?? null;
}

export async function writeStoredJiraSession(session: JiraOAuthSessionStorage): Promise<void> {
  await chrome.storage.local.set({[jiraStorageKey]: session});
}

export function createPkceVerifier(): string {
  const randomValues = crypto.getRandomValues(new Uint8Array(32));

  return toBase64Url(randomValues);
}

export async function createPkceChallenge(verifier: string): Promise<string> {
  const encodedVerifier = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encodedVerifier);

  return toBase64Url(new Uint8Array(digest));
}

export function toBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));

  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function getAtlassianClientSecret(): string | undefined {
  const clientSecret = typeof __ATLASSIAN_OAUTH_CLIENT_SECRET__ === 'string'
    ? __ATLASSIAN_OAUTH_CLIENT_SECRET__.trim()
    : '';

  return clientSecret || undefined;
}

async function readOAuthErrorDetails(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json() as {
      readonly error?: string;
      readonly error_description?: string;
      readonly message?: string;
    };
    const parts = [payload.error, payload.error_description, payload.message]
      .filter((part): part is string => Boolean(part))
      .map(part => part.trim())
      .filter(Boolean);

    return parts.length ? parts.join(' - ') : '';
  } catch {
    try {
      const text = (await response.clone().text()).trim();
      return text ? text.slice(0, 400) : '';
    } catch {
      return '';
    }
  }
}
