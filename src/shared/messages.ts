import type {
  AccessibilityReport,
  AccessibleNodeSummary,
  AuditSettings,
  CaptureBoundsSnapshot,
  ComponentScope,
  ComponentScopeOption,
  EvidenceCaptureMode,
  JiraAuthSession,
  JiraIssueTypeOption,
  JiraProjectOption,
  JiraSiteOption,
  LayerVisibility,
  NarratorCommand,
  ReaderModeSettings,
  ViolationFilterSettings,
} from './accessibility-report';

export const enum RuntimeMessageType {
  ActiveTabChanged = 'active-tab.changed',
  ActiveNodeChanged = 'active-node.changed',
  AnalysisFailed = 'analysis.failed',
  AnalysisRequested = 'analysis.requested',
  CaptureBoundsRequested = 'capture-bounds.requested',
  ComponentInventoryChanged = 'component-inventory.changed',
  ComponentScopeChanged = 'component-scope.changed',
  ContentReady = 'content.ready',
  EvidenceImageCaptureRequested = 'evidence-image-capture.requested',
  EvidencePdfExportRequested = 'evidence-pdf-export.requested',
  EvidenceVideoBufferToggled = 'evidence-video-buffer.toggled',
  EvidenceVideoRollbackRequested = 'evidence-video-rollback.requested',
  JiraAuthStatusRequested = 'jira-auth-status.requested',
  JiraConnectRequested = 'jira-connect.requested',
  JiraDisconnectRequested = 'jira-disconnect.requested',
  JiraIssueCreateRequested = 'jira-issue-create.requested',
  JiraIssueTypesRequested = 'jira-issue-types.requested',
  JiraProjectsRequested = 'jira-projects.requested',
  JiraSitesRequested = 'jira-sites.requested',
  LayerVisibilityChanged = 'layer-visibility.changed',
  PageContextRequested = 'page-context.requested',
  PanelOpened = 'side-panel.opened',
  ReaderModeChanged = 'reader-mode.changed',
  ReaderCommandRequested = 'reader.command-requested',
  ReaderSpeechControlRequested = 'reader.speech-control.requested',
  ReaderSpeakRequested = 'reader.speak-requested',
  ReaderVoicesRequested = 'reader.voices-requested',
  ReportGenerated = 'report.generated',
  ResetRequested = 'analysis.reset-requested',
  ResetCompleted = 'analysis.reset-completed',
  TabReloaded = 'tab.reloaded',
  ViolationFocusChanged = 'violation-focus.changed',
  ViolationFiltersChanged = 'violation-filters.changed',
  ViolationSelected = 'violation.selected'
}

export interface ContentReadyPayload {
  readonly title: string;
  readonly url: string;
}

export interface MessageEnvelope<TType extends RuntimeMessageType, TPayload> {
  readonly payload: TPayload;
  readonly tabId?: number;
  readonly type: TType;
}

export type ContentReadyMessage = MessageEnvelope<
  RuntimeMessageType.ContentReady,
  ContentReadyPayload
>;

export interface ActiveTabChangedPayload {
  readonly tabId: number;
}

export type ActiveTabChangedMessage = MessageEnvelope<
  RuntimeMessageType.ActiveTabChanged,
  ActiveTabChangedPayload
>;

export type AnalysisRequestedMessage = MessageEnvelope<
  RuntimeMessageType.AnalysisRequested,
  AuditSettings
>;

export interface AnalysisFailedPayload {
  readonly message: string;
}

export type AnalysisFailedMessage = MessageEnvelope<
  RuntimeMessageType.AnalysisFailed,
  AnalysisFailedPayload
>;

export interface CaptureBoundsRequestPayload {
  readonly mode: Extract<EvidenceCaptureMode, 'element' | 'free-select'>;
}

export type CaptureBoundsRequestedMessage = MessageEnvelope<
  RuntimeMessageType.CaptureBoundsRequested,
  CaptureBoundsRequestPayload
>;

export type ComponentInventoryChangedMessage = MessageEnvelope<
  RuntimeMessageType.ComponentInventoryChanged,
  readonly ComponentScopeOption[]
>;

export type ComponentScopeChangedMessage = MessageEnvelope<
  RuntimeMessageType.ComponentScopeChanged,
  ComponentScope | null
>;

export interface EvidenceImageCaptureRequestPayload {
  readonly mode: EvidenceCaptureMode;
}

export type EvidenceImageCaptureRequestedMessage = MessageEnvelope<
  RuntimeMessageType.EvidenceImageCaptureRequested,
  EvidenceImageCaptureRequestPayload
>;

export interface EvidenceImageCaptureResponse {
  readonly error?: string;
  readonly fileNameBase?: string;
  readonly ok: boolean;
  readonly screenshotDataUrl?: string;
  readonly snapshot?: CaptureBoundsSnapshot;
}

export interface EvidencePdfExportRequestPayload {
  readonly includeEvidenceImages: boolean;
}

export type EvidencePdfExportRequestedMessage = MessageEnvelope<
  RuntimeMessageType.EvidencePdfExportRequested,
  EvidencePdfExportRequestPayload
>;

export interface EvidenceVideoBufferTogglePayload {
  readonly enabled: boolean;
}

export type EvidenceVideoBufferToggledMessage = MessageEnvelope<
  RuntimeMessageType.EvidenceVideoBufferToggled,
  EvidenceVideoBufferTogglePayload
>;

export interface EvidenceVideoBufferToggleResponse {
  readonly error?: string;
  readonly ok: boolean;
}

export interface EvidenceVideoRollbackRequestPayload {
  readonly minutes: number;
}

export type EvidenceVideoRollbackRequestedMessage = MessageEnvelope<
  RuntimeMessageType.EvidenceVideoRollbackRequested,
  EvidenceVideoRollbackRequestPayload
>;

export interface EvidenceVideoRollbackResponse {
  readonly error?: string;
  readonly ok: boolean;
}

export type JiraAuthStatusRequestedMessage = MessageEnvelope<
  RuntimeMessageType.JiraAuthStatusRequested,
  Record<string, never>
>;

export interface JiraConnectRequestPayload {
  readonly clientId: string;
}

export type JiraConnectRequestedMessage = MessageEnvelope<
  RuntimeMessageType.JiraConnectRequested,
  JiraConnectRequestPayload
>;

export type JiraDisconnectRequestedMessage = MessageEnvelope<
  RuntimeMessageType.JiraDisconnectRequested,
  Record<string, never>
>;

export interface JiraIssueCreateRequestPayload {
  readonly description: string;
  readonly evidenceImageDataUrls: readonly string[];
  readonly issueTypeId: string;
  readonly linkIssueKey?: string;
  readonly linkTypeName?: string;
  readonly parentIssueKey?: string;
  readonly projectKey: string;
  readonly summary: string;
}

export type JiraIssueCreateRequestedMessage = MessageEnvelope<
  RuntimeMessageType.JiraIssueCreateRequested,
  JiraIssueCreateRequestPayload
>;

export type JiraIssueTypesRequestedMessage = MessageEnvelope<
  RuntimeMessageType.JiraIssueTypesRequested,
  {readonly projectKey: string}
>;

export type JiraProjectsRequestedMessage = MessageEnvelope<
  RuntimeMessageType.JiraProjectsRequested,
  Record<string, never>
>;

export type JiraSitesRequestedMessage = MessageEnvelope<
  RuntimeMessageType.JiraSitesRequested,
  Record<string, never>
>;

export interface JiraAuthStatusResponse {
  readonly session: JiraAuthSession;
}

export interface JiraConnectResponse {
  readonly error?: string;
  readonly ok: boolean;
  readonly session?: JiraAuthSession;
}

export interface JiraDisconnectResponse {
  readonly error?: string;
  readonly ok: boolean;
}

export interface JiraIssueCreateResponse {
  readonly error?: string;
  readonly issueKey?: string;
  readonly issueUrl?: string;
  readonly ok: boolean;
}

export interface JiraIssueTypesResponse {
  readonly error?: string;
  readonly issueTypes: readonly JiraIssueTypeOption[];
  readonly ok: boolean;
}

export interface JiraProjectsResponse {
  readonly error?: string;
  readonly ok: boolean;
  readonly projects: readonly JiraProjectOption[];
}

export interface JiraSitesResponse {
  readonly error?: string;
  readonly ok: boolean;
  readonly sites: readonly JiraSiteOption[];
}

export type ActiveNodeChangedMessage = MessageEnvelope<
  RuntimeMessageType.ActiveNodeChanged,
  AccessibleNodeSummary | null
>;

export type LayerVisibilityChangedMessage = MessageEnvelope<
  RuntimeMessageType.LayerVisibilityChanged,
  LayerVisibility
>;

export type PageContextRequestedMessage = MessageEnvelope<
  RuntimeMessageType.PageContextRequested,
  Record<string, never>
>;

export type PanelOpenedMessage = MessageEnvelope<
  RuntimeMessageType.PanelOpened,
  Record<string, never>
>;

export type ReportGeneratedMessage = MessageEnvelope<
  RuntimeMessageType.ReportGenerated,
  AccessibilityReport
>;

export type ResetRequestedMessage = MessageEnvelope<
  RuntimeMessageType.ResetRequested,
  Record<string, never>
>;

export type ResetCompletedMessage = MessageEnvelope<
  RuntimeMessageType.ResetCompleted,
  Record<string, never>
>;

export type TabReloadedMessage = MessageEnvelope<
  RuntimeMessageType.TabReloaded,
  Record<string, never>
>;

export interface ViolationSelectedPayload {
  readonly selector: string;
  readonly violationId: string;
}

export type ViolationSelectedMessage = MessageEnvelope<
  RuntimeMessageType.ViolationSelected,
  ViolationSelectedPayload | null
>;

export type ViolationFocusChangedMessage = MessageEnvelope<
  RuntimeMessageType.ViolationFocusChanged,
  ViolationSelectedPayload | null
>;

export type ViolationFiltersChangedMessage = MessageEnvelope<
  RuntimeMessageType.ViolationFiltersChanged,
  ViolationFilterSettings
>;

export type ReaderModeChangedMessage = MessageEnvelope<
  RuntimeMessageType.ReaderModeChanged,
  ReaderModeSettings
>;

export type ReaderCommandRequestedMessage = MessageEnvelope<
  RuntimeMessageType.ReaderCommandRequested,
  NarratorCommand
>;

export interface ReaderSpeechControlPayload {
  readonly action: 'pause' | 'resume' | 'stop';
}

export type ReaderSpeechControlRequestedMessage = MessageEnvelope<
  RuntimeMessageType.ReaderSpeechControlRequested,
  ReaderSpeechControlPayload
>;

export interface ReaderSpeakPayload {
  readonly readerMode: ReaderModeSettings;
  readonly text: string;
}

export type ReaderSpeakRequestedMessage = MessageEnvelope<
  RuntimeMessageType.ReaderSpeakRequested,
  ReaderSpeakPayload
>;

export interface ReaderVoiceOption {
  readonly gender?: string;
  readonly label: string;
  readonly lang: string;
  readonly localService: boolean;
  readonly name: string;
  readonly remote?: boolean;
  readonly voiceURI: string;
}

export type ReaderVoicesRequestedMessage = MessageEnvelope<
  RuntimeMessageType.ReaderVoicesRequested,
  Record<string, never>
>;

export interface ReaderVoicesResponse {
  readonly error?: string;
  readonly ok: boolean;
  readonly voices: readonly ReaderVoiceOption[];
}

export type RuntimeMessage =
  | ActiveNodeChangedMessage
  | ActiveTabChangedMessage
  | AnalysisFailedMessage
  | AnalysisRequestedMessage
  | CaptureBoundsRequestedMessage
  | ComponentInventoryChangedMessage
  | ComponentScopeChangedMessage
  | ContentReadyMessage
  | EvidenceImageCaptureRequestedMessage
  | EvidencePdfExportRequestedMessage
  | EvidenceVideoBufferToggledMessage
  | EvidenceVideoRollbackRequestedMessage
  | JiraAuthStatusRequestedMessage
  | JiraConnectRequestedMessage
  | JiraDisconnectRequestedMessage
  | JiraIssueCreateRequestedMessage
  | JiraIssueTypesRequestedMessage
  | JiraProjectsRequestedMessage
  | JiraSitesRequestedMessage
  | LayerVisibilityChangedMessage
  | PageContextRequestedMessage
  | PanelOpenedMessage
  | ReaderCommandRequestedMessage
  | ReaderModeChangedMessage
  | ReaderSpeechControlRequestedMessage
  | ReaderSpeakRequestedMessage
  | ReaderVoicesRequestedMessage
  | ReportGeneratedMessage
  | ResetCompletedMessage
  | ResetRequestedMessage
  | TabReloadedMessage
  | ViolationFocusChangedMessage
  | ViolationFiltersChangedMessage
  | ViolationSelectedMessage;
