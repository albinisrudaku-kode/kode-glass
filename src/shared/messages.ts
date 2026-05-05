import type {
  AccessibilityReport,
  AccessibleNodeSummary,
  AuditSettings,
  CaptureBoundsSnapshot,
  ComponentScope,
  ComponentScopeOption,
  EvidenceCaptureMode,
  LayerVisibility,
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
  EvidenceVideoBufferToggled = 'evidence-video-buffer.toggled',
  EvidenceVideoRollbackRequested = 'evidence-video-rollback.requested',
  LayerVisibilityChanged = 'layer-visibility.changed',
  PageContextRequested = 'page-context.requested',
  PanelOpened = 'side-panel.opened',
  ReaderModeChanged = 'reader-mode.changed',
  ReaderSpeakRequested = 'reader.speak-requested',
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

export interface ReaderSpeakPayload {
  readonly readerMode: ReaderModeSettings;
  readonly text: string;
}

export type ReaderSpeakRequestedMessage = MessageEnvelope<
  RuntimeMessageType.ReaderSpeakRequested,
  ReaderSpeakPayload
>;

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
  | EvidenceVideoBufferToggledMessage
  | EvidenceVideoRollbackRequestedMessage
  | LayerVisibilityChangedMessage
  | PageContextRequestedMessage
  | PanelOpenedMessage
  | ReaderModeChangedMessage
  | ReaderSpeakRequestedMessage
  | ReportGeneratedMessage
  | ResetCompletedMessage
  | ResetRequestedMessage
  | TabReloadedMessage
  | ViolationFocusChangedMessage
  | ViolationFiltersChangedMessage
  | ViolationSelectedMessage;
