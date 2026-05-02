import type {
  AccessibilityReport,
  AccessibleNodeSummary,
  AuditSettings,
  LayerVisibility,
  ReaderModeSettings,
} from './accessibility-report';

export const enum RuntimeMessageType {
  ActiveNodeChanged = 'active-node.changed',
  AnalysisFailed = 'analysis.failed',
  AnalysisRequested = 'analysis.requested',
  ContentReady = 'content.ready',
  LayerVisibilityChanged = 'layer-visibility.changed',
  ReaderModeChanged = 'reader-mode.changed',
  ReportGenerated = 'report.generated',
  ResetRequested = 'analysis.reset-requested',
  ResetCompleted = 'analysis.reset-completed',
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

export type ActiveNodeChangedMessage = MessageEnvelope<
  RuntimeMessageType.ActiveNodeChanged,
  AccessibleNodeSummary | null
>;

export type LayerVisibilityChangedMessage = MessageEnvelope<
  RuntimeMessageType.LayerVisibilityChanged,
  LayerVisibility
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

export interface ViolationSelectedPayload {
  readonly selector: string;
  readonly violationId: string;
}

export type ViolationSelectedMessage = MessageEnvelope<
  RuntimeMessageType.ViolationSelected,
  ViolationSelectedPayload
>;

export type ReaderModeChangedMessage = MessageEnvelope<
  RuntimeMessageType.ReaderModeChanged,
  ReaderModeSettings
>;

export type RuntimeMessage =
  | ActiveNodeChangedMessage
  | AnalysisFailedMessage
  | AnalysisRequestedMessage
  | ContentReadyMessage
  | LayerVisibilityChangedMessage
  | ReaderModeChangedMessage
  | ReportGeneratedMessage
  | ResetCompletedMessage
  | ResetRequestedMessage
  | ViolationSelectedMessage;
