import {computed, signal} from '@angular/core';
import {getErrorMessage} from '../../shared/error-boundary';
import type {JiraAuthSession, JiraIssueTypeOption, JiraProjectOption} from '../../shared/accessibility-report';
import {
  RuntimeMessageType,
  type JiraAuthStatusResponse,
  type JiraConnectResponse,
  type JiraDisconnectResponse,
  type JiraIssueCreateRequestPayload,
  type JiraIssueCreateResponse,
  type JiraIssueTypesResponse,
  type JiraProjectsResponse,
} from '../../shared/messages';

declare const __ATLASSIAN_OAUTH_CLIENT_ID__: string;

const jiraDefaultClientId = (__ATLASSIAN_OAUTH_CLIENT_ID__ || '').trim();

export interface JiraServiceDeps {
  readonly getSessionTabId: () => Promise<number | undefined>;
  readonly setError: (error: string | null) => void;
}

export class JiraService {
  readonly sessionSignal = signal<JiraAuthSession>({status: 'disconnected'});
  readonly clientIdSignal = signal(jiraDefaultClientId);
  readonly projectsSignal = signal<readonly JiraProjectOption[]>([]);
  readonly issueTypesSignal = signal<readonly JiraIssueTypeOption[]>([]);
  readonly projectKeySignal = signal('');
  readonly issueTypeIdSignal = signal('');
  readonly pendingSignal = signal(false);

  readonly session = this.sessionSignal.asReadonly();
  readonly clientId = this.clientIdSignal.asReadonly();
  readonly projects = this.projectsSignal.asReadonly();
  readonly issueTypes = this.issueTypesSignal.asReadonly();
  readonly projectKey = this.projectKeySignal.asReadonly();
  readonly issueTypeId = this.issueTypeIdSignal.asReadonly();
  readonly pending = this.pendingSignal.asReadonly();
  readonly connected = computed(() => this.session().status === 'connected');
  readonly oauthConfigured = computed(() => Boolean(this.resolveConfiguredJiraClientId()));

  private readonly deps: JiraServiceDeps;

  constructor(deps: JiraServiceDeps) {
    this.deps = deps;
  }

  private resolveConfiguredJiraClientId(): string {
    return this.clientId().trim() || jiraDefaultClientId.trim();
  }

  setProjectKey(projectKey: string): void {
    this.projectKeySignal.set(projectKey);
    this.issueTypeIdSignal.set('');
    this.issueTypesSignal.set([]);
    void this.refreshIssueTypes(projectKey);
  }

  setIssueTypeId(issueTypeId: string): void {
    this.issueTypeIdSignal.set(issueTypeId);
  }

  async connect(): Promise<void> {
    const clientId = this.resolveConfiguredJiraClientId();

    if (!clientId) {
      this.deps.setError('Jira OAuth client ID is missing. Set ATLASSIAN_OAUTH_CLIENT_ID and rebuild the extension.');

      return;
    }

    this.pendingSignal.set(true);
    this.deps.setError(null);
    this.sessionSignal.set({status: 'connecting'});

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {clientId},
        tabId: await this.deps.getSessionTabId(),
        type: RuntimeMessageType.JiraConnectRequested,
      }) as JiraConnectResponse;

      if (!response.ok || !response.session) {
        this.sessionSignal.set({error: response.error, status: 'disconnected'});
        this.deps.setError(response.error ?? 'Failed to connect Jira.');

        return;
      }

      this.sessionSignal.set(response.session);
      await this.refreshProjects();
    } catch (error) {
      this.sessionSignal.set({error: getErrorMessage(error), status: 'disconnected'});
      this.deps.setError(`Failed to connect Jira: ${getErrorMessage(error)}`);
    } finally {
      this.pendingSignal.set(false);
    }
  }

  async disconnect(): Promise<void> {
    this.pendingSignal.set(true);
    this.deps.setError(null);

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {},
        tabId: await this.deps.getSessionTabId(),
        type: RuntimeMessageType.JiraDisconnectRequested,
      }) as JiraDisconnectResponse;

      if (!response.ok) {
        this.deps.setError(response.error ?? 'Failed to disconnect Jira.');

        return;
      }

      this.sessionSignal.set({status: 'disconnected'});
      this.projectsSignal.set([]);
      this.issueTypesSignal.set([]);
      this.projectKeySignal.set('');
      this.issueTypeIdSignal.set('');
    } catch (error) {
      this.deps.setError(`Failed to disconnect Jira: ${getErrorMessage(error)}`);
    } finally {
      this.pendingSignal.set(false);
    }
  }

  async initializeState(): Promise<void> {
    const status = await chrome.runtime.sendMessage({
      payload: {},
      tabId: await this.deps.getSessionTabId(),
      type: RuntimeMessageType.JiraAuthStatusRequested,
    }) as JiraAuthStatusResponse;
    this.sessionSignal.set(status.session);

    if (status.session.status === 'connected') {
      await this.refreshProjects();
    }
  }

  async refreshProjects(): Promise<void> {
    const response = await chrome.runtime.sendMessage({
      payload: {},
      tabId: await this.deps.getSessionTabId(),
      type: RuntimeMessageType.JiraProjectsRequested,
    }) as JiraProjectsResponse;

    if (!response.ok) {
      this.deps.setError(response.error ?? 'Unable to load Jira projects.');

      return;
    }

    this.projectsSignal.set(response.projects);

    if (!this.projectKey() && response.projects.length) {
      const firstProject = response.projects[0]!;
      this.projectKeySignal.set(firstProject.key);
      await this.refreshIssueTypes(firstProject.key);
    }
  }

  async refreshIssueTypes(projectKey: string): Promise<void> {
    if (!projectKey) {
      return;
    }

    const response = await chrome.runtime.sendMessage({
      payload: {projectKey},
      tabId: await this.deps.getSessionTabId(),
      type: RuntimeMessageType.JiraIssueTypesRequested,
    }) as JiraIssueTypesResponse;

    if (!response.ok) {
      this.deps.setError(response.error ?? 'Unable to load Jira issue types.');

      return;
    }

    this.issueTypesSignal.set(response.issueTypes);

    if (!this.issueTypeId() && response.issueTypes.length) {
      const firstIssueType = response.issueTypes[0]!;
      this.issueTypeIdSignal.set(firstIssueType.id);
    }
  }

  async createIssue(params: JiraIssueCreateRequestPayload): Promise<void> {
    this.pendingSignal.set(true);
    this.deps.setError(null);

    try {
      const response = await chrome.runtime.sendMessage({
        payload: params,
        tabId: await this.deps.getSessionTabId(),
        type: RuntimeMessageType.JiraIssueCreateRequested,
      }) as JiraIssueCreateResponse;

      if (!response.ok || !response.issueKey) {
        this.deps.setError(response.error ?? 'Unable to create Jira task.');

        return;
      }

      this.deps.setError(`Created Jira task ${response.issueKey}.`);
    } catch (error) {
      this.deps.setError(`Unable to create Jira task: ${getErrorMessage(error)}`);
    } finally {
      this.pendingSignal.set(false);
    }
  }
}
