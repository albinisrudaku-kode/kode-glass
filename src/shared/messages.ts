import type {
  AccessibilityReport,
  AccessibleNodeSummary,
  AuditSettings,
  ComponentScope,
  ComponentScopeOption,
  LayerVisibility,
  ReaderModeSettings,
  ViolationFilterSettings,
} from './accessibility-report';

export const enum RuntimeMessageType {
  ActiveTabChanged = 'active-tab.changed',
  ActiveNodeChanged = 'active-node.changed',
  AnalysisFailed = 'analysis.failed',
  AnalysisRequested = 'analysis.requested',
  ComponentInventoryChanged = 'component-inventory.changed',
  ComponentScopeChanged = 'component-scope.changed',
  ContentReady = 'content.ready',
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

export type ComponentInventoryChangedMessage = MessageEnvelope<
  RuntimeMessageType.ComponentInventoryChanged,
  readonly ComponentScopeOption[]
>;

export type ComponentScopeChangedMessage = MessageEnvelope<
  RuntimeMessageType.ComponentScopeChanged,
  ComponentScope | null
>;

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
  | ComponentInventoryChangedMessage
  | ComponentScopeChangedMessage
  | ContentReadyMessage
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
